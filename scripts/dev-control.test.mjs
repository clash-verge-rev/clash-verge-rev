import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspect } from 'node:util'

import {
  createMacosShutdownController,
  readPrivateInstanceRecord,
  requestDevQuit,
  waitForPortClosed,
} from './dev-control.mjs'
import {
  buildTauriInvocation,
  mirrorChildExit,
  runDevAnchor,
  runDevCommand,
  terminateDetachedGroup,
} from './dev.mjs'
import { windowsElevationInvocation } from './dev-service.mjs'

const token = 'ab'.repeat(32)
const posixOnly = {
  skip: process.platform === 'win32' ? 'requires POSIX file metadata' : false,
}

test('Windows elevation passes the installer path outside PowerShell source', () => {
  const installer = String.raw`C:\ssp\path with spaces\clash-verge-service-install.exe`
  const baseEnvironment = { SYSTEMROOT: String.raw`C:\Windows` }

  const invocation = windowsElevationInvocation(installer, baseEnvironment)

  assert.equal(invocation.command, 'powershell.exe')
  assert.equal(invocation.args.at(-2), '-Command')
  assert.equal(invocation.args.includes(installer), false)
  assert.equal(invocation.env.CLASH_VERGE_DEV_SERVICE_INSTALLER, installer)
  assert.equal(baseEnvironment.CLASH_VERGE_DEV_SERVICE_INSTALLER, undefined)
})

async function withTemporaryDirectory(run) {
  const root = await mkdtemp(join(tmpdir(), 'clash-verge-dev-control-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function requestSequence(statuses, requests) {
  return (options, onResponse) => {
    const outgoing = new EventEmitter()
    outgoing.setTimeout = () => outgoing
    outgoing.destroy = (error) =>
      queueMicrotask(() => outgoing.emit('error', error))
    outgoing.end = () => {
      requests.push(options)
      const outcome = statuses.shift()
      if (outcome instanceof Error) {
        queueMicrotask(() => outgoing.emit('error', outcome))
        return
      }
      const response = new EventEmitter()
      response.statusCode = outcome
      response.resume = () => {}
      response.destroy = () => {}
      queueMicrotask(() => {
        onResponse(response)
        queueMicrotask(() => response.emit('end'))
      })
    }
    return outgoing
  }
}

function responseLifecycleRequest(status, events) {
  return (_options, onResponse) => {
    const outgoing = new EventEmitter()
    outgoing.setTimeout = () => outgoing
    outgoing.destroy = (error) =>
      queueMicrotask(() => outgoing.emit('error', error))
    outgoing.end = () => {
      const response = new EventEmitter()
      response.statusCode = status
      response.resume = () => {}
      response.destroy = () => {}
      queueMicrotask(() => {
        onResponse(response)
        for (const event of events) {
          response.emit(
            event,
            event === 'error' ? new Error('response failed') : undefined,
          )
        }
      })
    }
    return outgoing
  }
}

function releasedResponseSequence(statuses, releases) {
  return (_options, onResponse) => {
    const outgoing = new EventEmitter()
    outgoing.setTimeout = () => outgoing
    outgoing.destroy = (error) =>
      queueMicrotask(() => outgoing.emit('error', error))
    outgoing.end = () => {
      const response = new EventEmitter()
      response.statusCode = statuses.shift()
      response.resume = () => {}
      response.destroy = () => {
        releases.push(response.statusCode)
        response.emit('aborted')
        response.emit('error', new Error('destroyed response'))
        response.emit('close')
      }
      queueMicrotask(() => onResponse(response))
    }
    return outgoing
  }
}

function createChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  return child
}

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve))
}

test(
  'private instance record must be an owned 0600 ordinary file',
  posixOnly,
  async () => {
    await withTemporaryDirectory(async (root) => {
      const recordPath = join(root, 'singleton-instance.json')
      await writeFile(recordPath, JSON.stringify({ port: 42123, token }), {
        mode: 0o600,
      })
      assert.deepEqual(
        await readPrivateInstanceRecord(recordPath, process.getuid()),
        {
          port: 42123,
          token,
        },
      )

      await chmod(recordPath, 0o644)
      await assert.rejects(
        readPrivateInstanceRecord(recordPath, process.getuid()),
        /0600/,
      )
    })
  },
)

test('private instance record rejects a symbolic link', posixOnly, async () => {
  await withTemporaryDirectory(async (root) => {
    const targetPath = join(root, 'target.json')
    const recordPath = join(root, 'singleton-instance.json')
    await writeFile(targetPath, JSON.stringify({ port: 42123, token }), {
      mode: 0o600,
    })
    await symlink(targetPath, recordPath)

    await assert.rejects(
      readPrivateInstanceRecord(recordPath, process.getuid()),
    )
  })
})

test('private instance record rejects the wrong owner', posixOnly, async () => {
  await withTemporaryDirectory(async (root) => {
    const recordPath = join(root, 'singleton-instance.json')
    await writeFile(recordPath, JSON.stringify({ port: 42123, token }), {
      mode: 0o600,
    })

    await assert.rejects(
      readPrivateInstanceRecord(recordPath, process.getuid() + 1),
      /owner/,
    )
  })
})

test('private instance record rejects invalid ports', posixOnly, async (t) => {
  for (const port of [0, 65536, 1.5, '42123']) {
    await t.test(String(port), async () => {
      await withTemporaryDirectory(async (root) => {
        const recordPath = join(root, 'singleton-instance.json')
        await writeFile(recordPath, JSON.stringify({ port, token }), {
          mode: 0o600,
        })
        await assert.rejects(
          readPrivateInstanceRecord(recordPath, process.getuid()),
          /port/,
        )
      })
    })
  }
})

test(
  'private instance record rejects tokens outside the lowercase 64-character format',
  posixOnly,
  async (t) => {
    for (const invalidToken of [
      'ab'.repeat(31),
      'AB'.repeat(32),
      'z'.repeat(64),
    ]) {
      await t.test(
        invalidToken.length === 64 ? invalidToken.slice(0, 2) : 'short',
        async () => {
          await withTemporaryDirectory(async (root) => {
            const recordPath = join(root, 'singleton-instance.json')
            await writeFile(
              recordPath,
              JSON.stringify({ port: 42123, token: invalidToken }),
              { mode: 0o600 },
            )
            await assert.rejects(
              readPrivateInstanceRecord(recordPath, process.getuid()),
              /token/,
            )
          })
        },
      )
    }
  },
)

test('requestDevQuit posts only to loopback and retries 503', async () => {
  const requests = []
  const record = { port: 42123, token }
  assert.deepEqual(
    await requestDevQuit(record, {
      requestImpl: requestSequence([503, 202], requests),
      retryDelayMs: 1,
      timeoutMs: 1_000,
    }),
    record,
  )
  assert.equal(requests.length, 2)
  for (const options of requests) {
    assert.equal(options.host, '127.0.0.1')
    assert.equal(options.port, 42123)
    assert.equal(options.method, 'POST')
    assert.equal(options.path, '/commands/dev/quit')
    assert.equal(options.headers['X-Instance-Token'], token)
  }
})

test('requestDevQuit retries a missing record source and returns the accepted record', async () => {
  let reads = 0
  const record = await requestDevQuit(
    async () => {
      reads += 1
      if (reads === 1) {
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      }
      return { port: 42123, token }
    },
    {
      requestImpl: requestSequence([202], []),
      retryDelayMs: 1,
      timeoutMs: 1_000,
    },
  )
  assert.deepEqual(record, { port: 42123, token })
  assert.equal(reads, 2)
})

test('requestDevQuit errors never disclose the instance token', async () => {
  await assert.rejects(
    requestDevQuit(
      { port: 42123, token },
      { requestImpl: requestSequence([500], []) },
    ),
    (error) => {
      assert.equal(error.message.includes(token), false)
      assert.match(error.message, /500/)
      return true
    },
  )
})

test('non-transient request errors preserve only a token-safe error cause', async () => {
  const unsafe = new Error(`permission denied for token ${token}`)
  unsafe.code = 'EACCES'
  unsafe.options = { headers: { 'X-Instance-Token': token } }
  let resultError

  await assert.rejects(
    requestDevQuit(
      { port: 42123, token },
      { requestImpl: requestSequence([unsafe], []) },
    ),
    (error) => {
      resultError = error
      return true
    },
  )

  const rendered = inspect(resultError, { depth: null })
  assert.equal(rendered.includes(token), false)
  assert.match(resultError.cause.message, /EACCES/)
  assert.notEqual(resultError.cause, unsafe)
})

test('requestDevQuit settles from response headers and consumes shutdown lifecycle events', async () => {
  const record = { port: 42123, token }
  for (const events of [
    ['aborted', 'close'],
    ['error', 'close'],
  ]) {
    assert.deepEqual(
      await requestDevQuit(record, {
        requestImpl: responseLifecycleRequest(202, events),
      }),
      record,
    )
  }
})

test('requestDevQuit actively releases 503 and 202 responses after headers', async () => {
  const releases = []
  assert.deepEqual(
    await requestDevQuit(
      { port: 42123, token },
      {
        requestImpl: releasedResponseSequence([503, 202], releases),
        retryDelayMs: 1,
        timeoutMs: 100,
      },
    ),
    { port: 42123, token },
  )
  assert.deepEqual(releases, [503, 202])
})

test('requestDevQuit retries transient connection errors without disclosing the token', async () => {
  const transient = new Error(`connect failed with secret ${token}`)
  transient.code = 'ECONNREFUSED'
  const requests = []
  assert.deepEqual(
    await requestDevQuit(
      { port: 42123, token },
      {
        requestImpl: requestSequence([transient, 202], requests),
        retryDelayMs: 1,
        timeoutMs: 100,
      },
    ),
    { port: 42123, token },
  )
  assert.equal(requests.length, 2)
})

test('requestDevQuit bounds ENOENT, 503, and transient-error retries', async (t) => {
  const cases = [
    {
      name: 'ENOENT',
      source: async () => {
        const error = new Error('missing')
        error.code = 'ENOENT'
        throw error
      },
      requestImpl: requestSequence([], []),
    },
    {
      name: '503',
      source: { port: 42123, token },
      requestImpl: requestSequence(Array(20).fill(503), []),
    },
    {
      name: 'transient error',
      source: { port: 42123, token },
      requestImpl: requestSequence(
        Array.from({ length: 20 }, () => {
          const error = new Error(`reset ${token}`)
          error.code = 'ECONNRESET'
          return error
        }),
        [],
      ),
    },
  ]

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await assert.rejects(
        requestDevQuit(entry.source, {
          requestImpl: entry.requestImpl,
          retryDelayMs: 1,
          timeoutMs: 5,
        }),
        (error) => {
          assert.match(error.message, /timed out/)
          assert.equal(error.message.includes(token), false)
          return true
        },
      )
    })
  }
})

test('waitForPortClosed resolves only after the loopback connection probe fails', async () => {
  let probes = 0
  await waitForPortClosed(42123, {
    probePort: async () => {
      probes += 1
      return probes < 3
    },
    retryDelayMs: 1,
    timeoutMs: 1_000,
  })
  assert.equal(probes, 3)
})

test('waitForPortClosed gives each probe only the remaining absolute budget', async () => {
  let now = 1_000
  const budgets = []
  await assert.rejects(
    waitForPortClosed(42123, {
      now: () => now,
      probePort: async (_port, budget) => {
        budgets.push(budget)
        return true
      },
      retryDelayMs: 3,
      sleep: async (milliseconds) => {
        now += milliseconds
      },
      timeoutMs: 10,
    }),
    /timed out/,
  )
  assert.deepEqual(budgets, [10, 7, 4, 1])
})

test('first SIGINT finalizes the group before exiting 130', async () => {
  const calls = []
  const controller = createMacosShutdownController({
    requestQuit: async () => {
      calls.push('request')
      return { port: 42123 }
    },
    waitForPortClosed: async () => {
      calls.push('closed')
    },
    waitForChildExit: async () => {
      calls.push('child')
    },
    terminateGroup: () => calls.push('terminate'),
    exit: (code) => calls.push(`exit:${code}`),
  })

  await controller.handleSigint()
  assert.deepEqual(calls, [
    'request',
    'closed',
    'child',
    'terminate',
    'exit:130',
  ])
})

test('first timeout preserves the group and second SIGINT forces it exactly once', async () => {
  const calls = []
  const controller = createMacosShutdownController({
    requestQuit: async () => {
      throw new Error('timed out')
    },
    waitForPortClosed: async () => {},
    waitForChildExit: async () => {},
    terminateGroup: () => calls.push('terminate'),
    exit: (code) => calls.push(`exit:${code}`),
    report: (message) => calls.push(message),
  })

  await controller.handleSigint()
  assert.equal(calls.includes('terminate'), false)
  assert.equal(
    calls.some((call) => String(call).includes('timed out')),
    true,
  )
  await controller.handleSigint()
  await controller.handleSigint()
  assert.equal(calls.filter((call) => call === 'terminate').length, 1)
})

test('second SIGINT terminates the group while the first request is still pending', async () => {
  let releaseRequest
  const requestPending = new Promise((resolve) => {
    releaseRequest = resolve
  })
  const calls = []
  const controller = createMacosShutdownController({
    requestQuit: async () => requestPending,
    waitForPortClosed: async () => {},
    waitForChildExit: async () => {},
    terminateGroup: () => calls.push('terminate'),
    exit: (code) => calls.push(`exit:${code}`),
  })

  const graceful = controller.handleSigint()
  await controller.handleSigint()
  assert.deepEqual(calls, ['terminate', 'exit:130'])
  releaseRequest({ port: 42123 })
  await graceful
})

test('third SIGINT shares the in-progress forced termination', async () => {
  let finishTermination
  const terminating = new Promise((resolve) => {
    finishTermination = resolve
  })
  const calls = []
  const controller = createMacosShutdownController({
    requestQuit: async () => new Promise(() => {}),
    waitForPortClosed: async () => {},
    waitForChildExit: async () => {},
    terminateGroup: async () => {
      calls.push('terminate')
      await terminating
    },
    exit: (code) => calls.push(`exit:${code}`),
  })

  void controller.handleSigint()
  const forced = controller.handleSigint()
  const repeated = controller.handleSigint()
  await flushTasks()
  assert.deepEqual(calls, ['terminate'])
  finishTermination()
  assert.equal(await forced, true)
  assert.equal(await repeated, true)
  assert.deepEqual(calls, ['terminate', 'exit:130'])
})

test('trace invocation preserves the existing Rust flags and Tauri arguments', () => {
  const invocation = buildTauriInvocation('trace', { PATH: '/bin' }, 'darwin')
  assert.deepEqual(invocation.args, [
    'exec',
    'tauri',
    'dev',
    '-f',
    'verge-dev',
    'tokio-trace',
  ])
  assert.equal(invocation.env.RUST_BACKTRACE, 'full')
  assert.equal(invocation.env.RUSTFLAGS, '--cfg tokio_unstable')
  assert.equal(invocation.detached, true)
})

test('normal dev invocation preserves arguments and remains direct off macOS', () => {
  const invocation = buildTauriInvocation('dev', { PATH: '/bin' }, 'linux')
  assert.equal(invocation.command, 'pnpm')
  assert.deepEqual(invocation.args, ['exec', 'tauri', 'dev', '-f', 'verge-dev'])
  assert.deepEqual(invocation.env, { PATH: '/bin', RUST_BACKTRACE: 'full' })
  assert.equal(invocation.detached, false)
})

test('sidecar invocation explicitly enables only the development sidecar feature', () => {
  const invocation = buildTauriInvocation('sidecar', { PATH: '/bin' }, 'win32')
  assert.deepEqual(invocation.args, [
    'exec',
    'tauri',
    'dev',
    '-f',
    'verge-dev,dev-sidecar',
  ])
  assert.equal(invocation.detached, false)
})

test('macOS parent launches a detached Node anchor with inherited stdio and IPC', async () => {
  const anchor = createChild(4321)
  let spawned
  const running = runDevCommand('trace', {
    environment: { HOME: '/tmp/home', PATH: '/bin' },
    installSigint: () => () => {},
    platform: 'darwin',
    spawnChild: (command, args, options) => {
      spawned = { command, args, options }
      queueMicrotask(() => {
        anchor.emit('spawn')
        anchor.emit('message', { type: 'ready' })
      })
      return anchor
    },
  })
  await running

  assert.equal(spawned.command, process.execPath)
  assert.deepEqual(spawned.args.slice(-2), ['--anchor', 'trace'])
  assert.equal(spawned.options.detached, true)
  assert.deepEqual(spawned.options.stdio, [
    'inherit',
    'inherit',
    'inherit',
    'ipc',
  ])
})

test('anchor launches the exact inner command non-detached and stays for release', async () => {
  const inner = createChild(8765)
  const sent = []
  const exits = []
  let handleMessage
  let handleSigterm
  let spawned
  const starting = runDevAnchor('trace', {
    environment: { PATH: '/bin' },
    exit: (code) => exits.push(code),
    installDisconnect: () => () => {},
    installMessage: (handler) => {
      handleMessage = handler
      return () => {}
    },
    installSigterm: (handler) => {
      handleSigterm = handler
      return () => {}
    },
    send: (message) => sent.push(message),
    spawnChild: (command, args, options) => {
      spawned = { command, args, options }
      queueMicrotask(() => inner.emit('spawn'))
      return inner
    },
  })
  await starting

  assert.equal(spawned.command, 'pnpm')
  assert.deepEqual(spawned.args, [
    'exec',
    'tauri',
    'dev',
    '-f',
    'verge-dev',
    'tokio-trace',
  ])
  assert.equal(spawned.options.detached, false)
  assert.equal(spawned.options.stdio, 'inherit')
  assert.deepEqual(sent, [{ type: 'ready' }])

  handleSigterm()
  assert.deepEqual(exits, [])
  inner.emit('exit', 0, null)
  await flushTasks()
  assert.deepEqual(sent.at(-1), {
    type: 'inner-result',
    code: 0,
    signal: null,
  })
  assert.deepEqual(exits, [])

  handleMessage({ type: 'release' })
  assert.deepEqual(exits, [0])
})

test('anchor cleans its own group after parent IPC disconnect', async () => {
  const inner = createChild(8765)
  const calls = []
  let handleDisconnect
  const starting = runDevAnchor('dev', {
    environment: { PATH: '/bin' },
    exit: (code) => calls.push(`exit:${code}`),
    installDisconnect: (handler) => {
      handleDisconnect = handler
      return () => {}
    },
    installMessage: () => () => {},
    installSigterm: () => () => {},
    ownPid: 4321,
    send: () => {},
    spawnChild: () => {
      queueMicrotask(() => inner.emit('spawn'))
      return inner
    },
    terminateGroup: async (pid) => calls.push(`terminate:${pid}`),
  })
  await starting

  handleDisconnect()
  await flushTasks()
  assert.deepEqual(calls, ['terminate:4321', 'exit:1'])
})

test('first finalize and second SIGINT share one group finalization', async () => {
  let finishFinalize
  const finalizing = new Promise((resolve) => {
    finishFinalize = resolve
  })
  const calls = []
  const controller = createMacosShutdownController({
    exit: (code) => calls.push(`exit:${code}`),
    finalizeGroup: async () => {
      calls.push('finalize')
      await finalizing
    },
    requestQuit: async () => ({ port: 42123 }),
    terminateGroup: async () => calls.push('force'),
    waitForChildExit: async () => {},
    waitForPortClosed: async () => {},
  })

  const graceful = controller.handleSigint()
  await flushTasks()
  const forced = controller.handleSigint()
  const repeated = controller.handleSigint()
  assert.deepEqual(calls, ['finalize'])
  finishFinalize()
  await Promise.all([graceful, forced, repeated])
  assert.equal(calls.filter((call) => call === 'finalize').length, 1)
  assert.equal(calls.includes('force'), false)
  assert.deepEqual(
    calls.filter((call) => call.startsWith('exit:')),
    ['exit:130'],
  )
})

test('graceful shutdown shares one absolute ten-second budget', async () => {
  let now = 1_000
  const budgets = []
  const controller = createMacosShutdownController({
    exit: () => {},
    finalizeGroup: async (budget) => {
      budgets.push(['finalize', budget])
      now += 500
    },
    now: () => now,
    requestQuit: async (budget) => {
      budgets.push(['request', budget])
      now += 3_000
      return { port: 42123 }
    },
    terminateGroup: async () => {},
    timeoutMs: 10_000,
    waitForChildExit: async (budget) => {
      budgets.push(['inner', budget])
      now += 4_000
    },
    waitForPortClosed: async (_port, budget) => {
      budgets.push(['endpoint', budget])
      now += 2_000
    },
  })

  await controller.handleSigint()
  assert.deepEqual(budgets, [
    ['request', 10_000],
    ['endpoint', 7_000],
    ['inner', 5_000],
    ['finalize', 1_000],
  ])
})

test('macOS validates HOME before spawning', async () => {
  let spawned = false
  await assert.rejects(
    runDevCommand('dev', {
      environment: { PATH: '/bin' },
      platform: 'darwin',
      spawnChild: () => {
        spawned = true
      },
    }),
    /HOME/,
  )
  assert.equal(spawned, false)
})

test('macOS rejects spawn failure and unavailable PID without group signals', async (t) => {
  for (const scenario of ['error', 'missing pid']) {
    await t.test(scenario, async () => {
      const child = createChild(undefined)
      const groupSignals = []
      const start = runDevCommand('dev', {
        environment: { HOME: '/tmp/home', PATH: '/bin' },
        installSigint: () => () => {},
        platform: 'darwin',
        signalGroup: (...args) => groupSignals.push(args),
        spawnChild: () => {
          queueMicrotask(() => {
            if (scenario === 'error')
              child.emit('error', new Error('spawn failed'))
            else child.emit('spawn')
          })
          return child
        },
      })
      await assert.rejects(start, scenario === 'error' ? /spawn failed/ : /PID/)
      assert.deepEqual(groupSignals, [])
    })
  }
})

test('SIGINT received during macOS spawn setup waits for a validated child PID', async () => {
  const child = createChild(4321)
  let handleSigint
  const calls = []
  const starting = runDevCommand('dev', {
    environment: { HOME: '/tmp/home', PATH: '/bin' },
    exit: (code) => calls.push(`exit:${code}`),
    installSigint: (handler) => {
      handleSigint = handler
      return () => {}
    },
    platform: 'darwin',
    requestQuit: async () => new Promise(() => {}),
    spawnChild: () => child,
    terminateGroup: async (pid) => calls.push(`terminate:${pid}`),
  })
  await flushTasks()
  handleSigint()
  handleSigint()
  assert.deepEqual(calls, [])
  child.emit('spawn')
  child.emit('message', { type: 'ready' })
  await starting
  await flushTasks()
  assert.deepEqual(calls, ['terminate:4321', 'exit:130'])
})

test('inner leader exit leaves the anchor available for lingering forced group cleanup', async () => {
  const child = createChild(4321)
  let handleSigint
  let finishTermination
  const terminating = new Promise((resolve) => {
    finishTermination = resolve
  })
  const calls = []
  const started = runDevCommand('dev', {
    environment: { HOME: '/tmp/home', PATH: '/bin' },
    exit: (code) => calls.push(`exit:${code}`),
    installSigint: (handler) => {
      handleSigint = handler
      return () => {}
    },
    mirrorResult: (result) =>
      calls.push(`mirror:${result.code}:${result.signal}`),
    platform: 'darwin',
    report: (message) => calls.push(message),
    requestQuit: async () => {
      throw new Error('timed out')
    },
    spawnChild: () => {
      queueMicrotask(() => {
        child.emit('spawn')
        child.emit('message', { type: 'ready' })
      })
      return child
    },
    terminateGroup: async () => {
      calls.push('terminate')
      await terminating
    },
  })
  await started

  handleSigint()
  await flushTasks()
  child.emit('message', {
    type: 'inner-result',
    code: 0,
    signal: null,
  })
  await flushTasks()
  assert.equal(
    calls.some((call) => call.startsWith('mirror:')),
    false,
  )
  handleSigint()
  handleSigint()
  await flushTasks()
  assert.equal(calls.filter((call) => call === 'terminate').length, 1)
  assert.equal(calls.includes('exit:130'), false)
  finishTermination()
  await flushTasks()
  assert.equal(calls.filter((call) => call === 'exit:130').length, 1)
})

test('unexpected anchor exit makes delayed force cleanup fail closed', async () => {
  const anchor = createChild(4321)
  let handleSigint
  const calls = []
  await runDevCommand('dev', {
    environment: { HOME: '/tmp/home', PATH: '/bin' },
    exit: (code) => calls.push(`exit:${code}`),
    installSigint: (handler) => {
      handleSigint = handler
      return () => {}
    },
    platform: 'darwin',
    report: (message) => calls.push(`report:${message}`),
    requestQuit: async () => {
      throw new Error('timed out')
    },
    signalGroup: (pid, signal) => calls.push(`signal:${pid}:${signal}`),
    spawnChild: () => {
      queueMicrotask(() => {
        anchor.emit('spawn')
        anchor.emit('message', { type: 'ready' })
      })
      return anchor
    },
  })

  handleSigint()
  await flushTasks()
  anchor.emit('exit', 1, null)
  await flushTasks()
  handleSigint()
  await flushTasks()

  assert.equal(
    calls.some((call) => call.startsWith('signal:')),
    false,
  )
  assert.equal(
    calls.some((call) => call.includes('unsafe')),
    true,
  )
  assert.deepEqual(
    calls.filter((call) => call.startsWith('exit:')),
    ['exit:1'],
  )
})

test('normal inner completion releases the anchor before mirroring the result', async () => {
  const anchor = createChild(4321)
  const calls = []
  anchor.send = (message, callback) => {
    calls.push(message.type)
    queueMicrotask(() => {
      callback?.()
      anchor.emit('exit', 0, null)
    })
  }
  await runDevCommand('dev', {
    environment: { HOME: '/tmp/home', PATH: '/bin' },
    installSigint: () => () => {},
    mirrorResult: ({ code, signal }) => calls.push(`mirror:${code}:${signal}`),
    platform: 'darwin',
    signalGroup: (pid, signal) => {
      calls.push(`probe:${pid}:${signal}`)
      const error = new Error('group absent')
      error.code = 'ESRCH'
      throw error
    },
    spawnChild: () => {
      queueMicrotask(() => {
        anchor.emit('spawn')
        anchor.emit('message', { type: 'ready' })
      })
      return anchor
    },
  })

  anchor.emit('message', {
    type: 'inner-result',
    code: 0,
    signal: null,
  })
  await flushTasks()
  await flushTasks()
  assert.deepEqual(calls, ['release', 'probe:-4321:0', 'mirror:0:null'])
})

test('normal release fails closed while the original group still exists', async () => {
  const anchor = createChild(4321)
  const calls = []
  anchor.send = (message, callback) => {
    calls.push(message.type)
    queueMicrotask(() => {
      callback?.()
      anchor.emit('exit', 0, null)
    })
  }
  await runDevCommand('dev', {
    environment: { HOME: '/tmp/home', PATH: '/bin' },
    exit: (code) => calls.push(`exit:${code}`),
    installSigint: () => () => {},
    mirrorResult: () => calls.push('mirror'),
    platform: 'darwin',
    report: (message) => calls.push(`report:${message}`),
    signalGroup: (pid, signal) => calls.push(`probe:${pid}:${signal}`),
    spawnChild: () => {
      queueMicrotask(() => {
        anchor.emit('spawn')
        anchor.emit('message', { type: 'ready' })
      })
      return anchor
    },
  })

  anchor.emit('message', {
    type: 'inner-result',
    code: 0,
    signal: null,
  })
  await flushTasks()
  await flushTasks()

  assert.deepEqual(calls, [
    'release',
    'probe:-4321:0',
    'report:Dev command failed: dev process group still exists after anchor exit',
    'exit:1',
  ])
})

test('failed forced cleanup is shared, reported once, and never mirrors child exit', async () => {
  const child = createChild(4321)
  let handleSigint
  const calls = []
  await runDevCommand('dev', {
    environment: { HOME: '/tmp/home', PATH: '/bin' },
    exit: (code) => calls.push(`exit:${code}`),
    installSigint: (handler) => {
      handleSigint = handler
      return () => {}
    },
    mirrorResult: () => calls.push('mirror'),
    platform: 'darwin',
    report: (message) => calls.push(`report:${message}`),
    requestQuit: async () => new Promise(() => {}),
    spawnChild: () => {
      queueMicrotask(() => {
        child.emit('spawn')
        child.emit('message', { type: 'ready' })
      })
      return child
    },
    terminateGroup: async () => {
      calls.push('terminate')
      throw new Error('forced cleanup failed')
    },
  })

  handleSigint()
  handleSigint()
  handleSigint()
  child.emit('exit', 0, null)
  await flushTasks()
  await flushTasks()

  assert.equal(calls.filter((call) => call === 'terminate').length, 1)
  assert.equal(calls.filter((call) => call.startsWith('report:')).length, 1)
  assert.deepEqual(
    calls.filter((call) => call.startsWith('exit:')),
    ['exit:1'],
  )
  assert.equal(calls.includes('mirror'), false)
})

test('detached group termination waits after TERM, then treats KILL ESRCH as success', async () => {
  let now = 0
  const calls = []
  await terminateDetachedGroup(4321, {
    graceMs: 100,
    now: () => now,
    signalGroup: (pid, signal) => {
      calls.push(`${pid}:${signal}`)
      if (signal === 'SIGKILL') {
        const error = new Error('gone')
        error.code = 'ESRCH'
        throw error
      }
    },
    sleep: async (milliseconds) => {
      calls.push(`sleep:${milliseconds}`)
      now += milliseconds
    },
  })
  assert.deepEqual(calls, [
    '-4321:SIGTERM',
    'sleep:50',
    '-4321:0',
    'sleep:50',
    '-4321:SIGKILL',
  ])
})

test('non-macOS wiring mirrors child exit codes and signals without installing SIGINT', async (t) => {
  for (const result of [
    { code: 7, signal: null },
    { code: null, signal: 'SIGTERM' },
  ]) {
    await t.test(
      result.code === null ? result.signal : String(result.code),
      async () => {
        const child = createChild(4321)
        const calls = []
        const running = runDevCommand('dev', {
          environment: { PATH: '/bin' },
          installSigint: () => {
            throw new Error('must not install SIGINT')
          },
          mirrorResult: (childResult) =>
            mirrorChildExit(childResult, {
              exit: (code) => calls.push(`exit:${code}`),
              signalSelf: (signal) => calls.push(`signal:${signal}`),
            }),
          platform: 'linux',
          spawnChild: () => {
            queueMicrotask(() => child.emit('exit', result.code, result.signal))
            return child
          },
        })
        await running
        assert.deepEqual(calls, [
          result.code === null ? 'signal:SIGTERM' : 'exit:7',
        ])
      },
    )
  }
})

test('non-macOS spawn errors consume every lifecycle rejection', async () => {
  const child = createChild(undefined)
  const unhandled = []
  const captureUnhandled = (error) => unhandled.push(error)
  process.prependListener('unhandledRejection', captureUnhandled)
  try {
    const running = runDevCommand('dev', {
      environment: { PATH: '/bin' },
      platform: 'linux',
      spawnChild: () => {
        queueMicrotask(() => child.emit('error', new Error('spawn failed')))
        return child
      },
    })
    await assert.rejects(running, /spawn failed/)
    await flushTasks()
    assert.deepEqual(unhandled, [])
  } finally {
    process.removeListener('unhandledRejection', captureUnhandled)
  }
})
