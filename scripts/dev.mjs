import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  createMacosShutdownController,
  readPrivateInstanceRecord,
  requestDevQuit,
  waitForPortClosed,
} from './dev-control.mjs'
import {
  developmentServiceDirectoryEnvironment,
  ensureDevelopmentService,
  prepareDevelopmentService,
} from './dev-service.mjs'

const FORCE_GRACE_MS = 2_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const FORCE_POLL_MS = 50
const ANCHOR_EXIT_RESERVE_MS = 100

export function buildTauriInvocation(
  mode,
  environment = process.env,
  platform = process.platform,
) {
  const env = { ...environment, RUST_BACKTRACE: 'full' }
  const features = mode === 'sidecar' ? 'verge-dev,dev-sidecar' : 'verge-dev'
  const args = ['exec', 'tauri', 'dev', '-f', features]
  if (mode === 'trace') {
    env.RUSTFLAGS = '--cfg tokio_unstable'
    args.push('tokio-trace')
  }
  return {
    command: 'pnpm',
    args,
    env,
    detached: platform === 'darwin',
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function childLifecycle(child) {
  const spawned = new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  spawned.catch(() => {})
  const result = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  result.catch(() => {})
  return { result, spawned }
}

function waitForPromise(promise, timeoutMs, message) {
  if (timeoutMs <= 0) return Promise.reject(new Error(message))
  let timeout
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timeout))
}

function signalDetachedGroup(childPid, signal, signalGroup) {
  if (!Number.isInteger(childPid) || childPid <= 0) {
    throw new Error('dev command did not provide a valid child PID')
  }
  try {
    signalGroup(-childPid, signal)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

export async function terminateDetachedGroup(
  childPid,
  {
    signalGroup = process.kill.bind(process),
    sleep = wait,
    now = Date.now,
    graceMs = FORCE_GRACE_MS,
    pollMs = FORCE_POLL_MS,
  } = {},
) {
  if (!signalDetachedGroup(childPid, 'SIGTERM', signalGroup)) return

  const deadline = now() + graceMs
  while (now() < deadline) {
    await sleep(Math.min(pollMs, deadline - now()))
    if (now() < deadline && !signalDetachedGroup(childPid, 0, signalGroup)) {
      return
    }
  }
  signalDetachedGroup(childPid, 'SIGKILL', signalGroup)
}

export function mirrorChildExit(
  { code, signal },
  {
    exit = (exitCode) => process.exit(exitCode),
    signalSelf = (childSignal) => {
      process.removeAllListeners(childSignal)
      process.kill(process.pid, childSignal)
    },
  } = {},
) {
  if (code !== null) {
    exit(code)
    return
  }
  if (signal) {
    signalSelf(signal)
    return
  }
  exit(1)
}

function defaultInstallSigint(handler) {
  process.on('SIGINT', handler)
  return () => process.off('SIGINT', handler)
}

function defaultInstallSigterm(handler) {
  process.on('SIGTERM', handler)
  return () => process.off('SIGTERM', handler)
}

function defaultInstallMessage(handler) {
  process.on('message', handler)
  return () => process.off('message', handler)
}

function defaultInstallDisconnect(handler) {
  process.on('disconnect', handler)
  return () => process.off('disconnect', handler)
}

function sendToParent(message) {
  if (process.connected && process.send) process.send(message, () => {})
}

export async function runDevAnchor(mode, dependencies = {}) {
  if (mode !== 'dev' && mode !== 'trace' && mode !== 'sidecar') {
    throw new Error('usage: node scripts/dev.mjs --anchor <dev|trace|sidecar>')
  }

  const environment = dependencies.environment ?? process.env
  const spawnChild = dependencies.spawnChild ?? spawn
  const send = dependencies.send ?? sendToParent
  const exit = dependencies.exit ?? ((code) => process.exit(code))
  const report = dependencies.report ?? ((message) => console.error(message))
  const ownPid = dependencies.ownPid ?? process.pid
  const terminateGroup =
    dependencies.terminateGroup ??
    ((pid) => terminateDetachedGroup(pid, { graceMs: FORCE_GRACE_MS }))
  let released = false
  let disconnectCleanup

  const installSigterm = dependencies.installSigterm ?? defaultInstallSigterm
  installSigterm(() => {})
  const installMessage = dependencies.installMessage ?? defaultInstallMessage
  installMessage((message) => {
    if (message?.type === 'release' && !disconnectCleanup) {
      released = true
      exit(0)
    }
  })
  const installDisconnect =
    dependencies.installDisconnect ?? defaultInstallDisconnect
  installDisconnect(() => {
    if (released || disconnectCleanup) return
    disconnectCleanup = Promise.resolve()
      .then(() => terminateGroup(ownPid))
      .then(() => exit(1))
      .catch((error) => {
        report(`Dev anchor cleanup failed: ${error.message}`)
        exit(1)
      })
  })

  const invocation = buildTauriInvocation(mode, environment, 'darwin')
  let inner
  try {
    inner = spawnChild(invocation.command, invocation.args, {
      env: invocation.env,
      detached: false,
      stdio: 'inherit',
    })
  } catch {
    send({ type: 'inner-error', code: 'SPAWN_FAILED' })
    return
  }
  if (!inner || typeof inner.once !== 'function') {
    send({ type: 'inner-error', code: 'SPAWN_FAILED' })
    return
  }

  const innerLifecycle = childLifecycle(inner)
  try {
    await innerLifecycle.spawned
  } catch {
    send({ type: 'inner-error', code: 'SPAWN_FAILED' })
    return
  }
  send({ type: 'ready' })
  innerLifecycle.result.then(
    ({ code, signal }) => send({ type: 'inner-result', code, signal }),
    () => send({ type: 'inner-error', code: 'INNER_FAILED' }),
  )
}

function createAnchorChannel(anchor, anchorResult) {
  let innerSettled = false
  let readySettled = false
  let resolveResult
  let rejectResult
  let resolveReady
  let rejectReady
  const innerResult = new Promise((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const settleInner = (callback, value) => {
    if (innerSettled) return
    innerSettled = true
    callback(value)
  }
  const settleReady = (callback, value) => {
    if (readySettled) return
    readySettled = true
    callback(value)
  }
  anchor.on('message', (message) => {
    if (message?.type === 'ready') {
      settleReady(resolveReady)
    } else if (message?.type === 'inner-result') {
      settleInner(resolveResult, {
        code: message.code,
        signal: message.signal,
      })
    } else if (message?.type === 'inner-error') {
      const error = new Error(
        `inner dev command failed (${message.code ?? 'UNKNOWN'})`,
      )
      settleReady(rejectReady, error)
      settleInner(rejectResult, error)
    }
  })
  anchorResult.then(
    () => {
      const error = new Error(
        'dev group anchor exited before the inner command completed',
      )
      settleReady(rejectReady, error)
      settleInner(rejectResult, error)
    },
    () => {
      const error = new Error('dev group anchor failed')
      settleReady(rejectReady, error)
      settleInner(rejectResult, error)
    },
  )
  ready.catch(() => {})
  innerResult.catch(() => {})
  return { innerResult, ready }
}

function sendRelease(anchor) {
  return new Promise((resolve, reject) => {
    if (typeof anchor.send !== 'function') {
      reject(new Error('dev group anchor IPC is unavailable'))
      return
    }
    anchor.send({ type: 'release' }, (error) => {
      if (error) reject(new Error('dev group anchor release failed'))
      else resolve()
    })
  })
}

function unsafeAnchorError() {
  return new Error('dev group anchor identity is unsafe')
}

export async function runDevCommand(mode, dependencies = {}) {
  if (mode !== 'dev' && mode !== 'trace' && mode !== 'sidecar') {
    throw new Error('usage: node scripts/dev.mjs <dev|trace|sidecar>')
  }

  const platform = dependencies.platform ?? process.platform
  const environment = dependencies.environment ?? process.env
  const spawnChild = dependencies.spawnChild ?? spawn
  const exit = dependencies.exit ?? ((code) => process.exit(code))
  const report = dependencies.report ?? ((message) => console.error(message))
  const mirrorResult = dependencies.mirrorResult ?? mirrorChildExit
  let recordPath
  let pendingSigints = 0
  let dispatchSigint = () => {
    pendingSigints += 1
  }
  let removeSigint = () => {}

  if (platform === 'darwin') {
    if (!environment.HOME) {
      throw new Error('HOME is required to locate the dev instance record')
    }
    recordPath = join(
      environment.HOME,
      'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev.dev/singleton-instance.json',
    )
    const installSigint = dependencies.installSigint ?? defaultInstallSigint
    removeSigint = installSigint(() => dispatchSigint()) ?? (() => {})
  }

  const tauriInvocation = buildTauriInvocation(mode, environment, platform)
  const anchorInvocation = {
    command: dependencies.execPath ?? process.execPath,
    args: [fileURLToPath(import.meta.url), '--anchor', mode],
    env: tauriInvocation.env,
    detached: true,
  }
  const invocation = platform === 'darwin' ? anchorInvocation : tauriInvocation
  let child
  try {
    child = spawnChild(invocation.command, invocation.args, {
      env: invocation.env,
      detached: invocation.detached,
      stdio:
        platform === 'darwin'
          ? ['inherit', 'inherit', 'inherit', 'ipc']
          : 'inherit',
    })
  } catch (error) {
    removeSigint()
    throw error
  }
  if (!child || typeof child.once !== 'function') {
    removeSigint()
    throw new Error('dev command failed to return a child process')
  }
  const outerLifecycle = childLifecycle(child)

  if (platform !== 'darwin') {
    mirrorResult(await outerLifecycle.result)
    return
  }

  let groupState = 'safe'
  let finalKillSent = false
  const anchorChannel = createAnchorChannel(child, outerLifecycle.result)
  outerLifecycle.result.then(
    () => {
      if (groupState !== 'released' && !finalKillSent) groupState = 'unsafe'
    },
    () => {
      groupState = 'unsafe'
    },
  )

  try {
    await outerLifecycle.spawned
    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      throw new Error('dev command did not provide a valid child PID')
    }
    await waitForPromise(
      anchorChannel.ready,
      SHUTDOWN_TIMEOUT_MS,
      'timed out waiting for the dev group anchor to initialize',
    )
  } catch (error) {
    removeSigint()
    throw error
  }

  const anchorPid = child.pid
  const innerResult = anchorChannel.innerResult
  let intercepted = false
  let observedShutdownOperation
  let anchorFinalization

  const signalGroup = dependencies.signalGroup ?? process.kill.bind(process)
  const guardedSignalGroup = (pid, signal) => {
    if (groupState === 'unsafe') throw unsafeAnchorError()
    if (signal === 'SIGKILL') finalKillSent = true
    try {
      signalGroup(pid, signal)
    } catch (error) {
      if (error?.code === 'ESRCH') {
        groupState = 'unsafe'
        throw unsafeAnchorError()
      }
      throw error
    }
  }

  const assertGroupAbsent = () => {
    try {
      signalGroup(-anchorPid, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return
      throw new Error('unable to verify that the dev process group exited', {
        cause: error,
      })
    }
    throw new Error('dev process group still exists after anchor exit')
  }

  const forceAnchor = async (budget) => {
    if (groupState === 'unsafe') throw unsafeAnchorError()
    groupState = 'terminating'
    if (dependencies.terminateGroup) {
      await dependencies.terminateGroup(anchorPid, budget)
      return
    }
    const deadline = Date.now() + budget
    await terminateDetachedGroup(anchorPid, {
      graceMs: Math.max(0, budget - ANCHOR_EXIT_RESERVE_MS),
      signalGroup: guardedSignalGroup,
    })
    await waitForPromise(
      outerLifecycle.result,
      Math.max(1, deadline - Date.now()),
      'timed out waiting for the dev group anchor to exit',
    )
  }

  const releaseAnchor = async (budget) => {
    if (groupState === 'unsafe') throw unsafeAnchorError()
    groupState = 'released'
    const deadline = Date.now() + budget
    await waitForPromise(
      sendRelease(child),
      Math.max(1, deadline - Date.now()),
      'timed out releasing the dev group anchor',
    )
    await waitForPromise(
      outerLifecycle.result,
      Math.max(1, deadline - Date.now()),
      'timed out waiting for the released dev group anchor',
    )
    assertGroupAbsent()
  }

  const finalizeAnchorOnce = (kind, budget) => {
    anchorFinalization ??=
      kind === 'release' ? releaseAnchor(budget) : forceAnchor(budget)
    return anchorFinalization
  }

  const getUid = dependencies.getUid ?? (() => process.getuid())
  const requestQuit =
    dependencies.requestQuit ??
    ((budget) =>
      requestDevQuit(() => readPrivateInstanceRecord(recordPath, getUid()), {
        timeoutMs: budget,
      }))

  const controller = createMacosShutdownController({
    requestQuit,
    waitForPortClosed: (port, budget) =>
      (dependencies.waitForPortClosed ?? waitForPortClosed)(port, {
        timeoutMs: budget,
      }),
    waitForChildExit: (budget) =>
      waitForPromise(
        innerResult,
        budget,
        'timed out waiting for the inner dev command to exit',
      ),
    finalizeGroup: (budget) => finalizeAnchorOnce('release', budget),
    terminateGroup: (budget) => finalizeAnchorOnce('force', budget),
    exit,
    report,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
  })

  dispatchSigint = () => {
    intercepted = true
    const operation = controller.handleSigint()
    if (operation !== observedShutdownOperation) {
      observedShutdownOperation = operation
      void operation.catch((error) => {
        report(`Forced dev shutdown failed: ${error.message}`)
        exit(1)
      })
    }
  }
  const queuedSigints = pendingSigints
  pendingSigints = 0
  for (let index = 0; index < queuedSigints; index += 1) {
    dispatchSigint()
  }

  innerResult.then(
    async (result) => {
      if (intercepted) return
      try {
        await finalizeAnchorOnce('release', SHUTDOWN_TIMEOUT_MS)
        if (!intercepted) mirrorResult(result)
      } catch (error) {
        if (!intercepted) {
          report(`Dev command failed: ${error.message}`)
          exit(1)
        }
      }
    },
    (error) => {
      if (!intercepted) {
        report(`Dev command failed: ${error.message}`)
        exit(1)
      }
    },
  )
}

export async function prepareDevRuntime(mode, dependencies = {}) {
  const ensureService = dependencies.ensureService ?? ensureDevelopmentService
  const prepareService =
    dependencies.prepareService ?? prepareDevelopmentService
  let serviceDirectory
  if (mode === 'service') {
    serviceDirectory = await ensureService()
  } else if (mode === 'dev' || mode === 'trace' || mode === 'sidecar') {
    serviceDirectory = await prepareService()
  }
  return {
    mode: mode === 'service' ? 'dev' : mode,
    serviceDirectory,
  }
}

async function run() {
  if (process.argv[2] === '--anchor') {
    await runDevAnchor(process.argv[3])
  } else {
    const { mode, serviceDirectory } = await prepareDevRuntime(process.argv[2])
    if (serviceDirectory) {
      process.env[developmentServiceDirectoryEnvironment] = serviceDirectory
    }
    await runDevCommand(mode)
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  run().catch((error) => {
    console.error(`Unable to start dev command: ${error.message}`)
    process.exit(1)
  })
}
