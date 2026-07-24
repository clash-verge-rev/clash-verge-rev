import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { request } from 'node:http'
import { connect } from 'node:net'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_DELAY_MS = 100
const TRANSIENT_REQUEST_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
])
const SAFE_REQUEST_ERROR_CODES = new Set([
  ...TRANSIENT_REQUEST_ERRORS,
  'EACCES',
  'EINVAL',
  'ENOTFOUND',
])

function validateInstanceRecord(record) {
  if (
    !record ||
    !Number.isInteger(record.port) ||
    record.port < 1 ||
    record.port > 65_535
  ) {
    throw new Error('invalid instance record port')
  }
  if (
    typeof record.token !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.token)
  ) {
    throw new Error('invalid instance record token')
  }
  return { port: record.port, token: record.token }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function safeRequestError(error) {
  const code = SAFE_REQUEST_ERROR_CODES.has(error?.code)
    ? error.code
    : 'UNKNOWN'
  const cause = new Error(code)
  cause.code = code
  return new Error('dev quit request failed', { cause })
}

export async function readPrivateInstanceRecord(path, expectedUid) {
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile()) {
      throw new Error('instance record must be an ordinary file')
    }
    if (stat.uid !== expectedUid) {
      throw new Error('instance record has the wrong owner')
    }
    if ((stat.mode & 0o777) !== 0o600) {
      throw new Error('instance record permissions must be 0600')
    }
    const contents = await handle.readFile({ encoding: 'utf8' })
    let record
    try {
      record = JSON.parse(contents)
    } catch {
      throw new Error('instance record is not valid JSON')
    }
    return validateInstanceRecord(record)
  } finally {
    await handle?.close()
  }
}

function postDevQuit(record, timeoutMs, requestImpl) {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      callback(value)
    }
    const outgoing = requestImpl(
      {
        host: '127.0.0.1',
        port: record.port,
        path: '/commands/dev/quit',
        method: 'POST',
        agent: false,
        headers: {
          'X-Instance-Token': record.token,
        },
      },
      (response) => {
        response.on('aborted', () => {})
        response.on('error', () => {})
        response.on('close', () => {})
        settle(resolve, response.statusCode)
        response.destroy()
      },
    )
    outgoing.once('error', (error) => settle(reject, error))
    outgoing.setTimeout(timeoutMs, () => {
      const error = new Error('dev quit request timed out')
      error.code = 'ETIMEDOUT'
      outgoing.destroy(error)
    })
    outgoing.end()
  })
}

export async function requestDevQuit(
  recordOrReader,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    requestImpl = request,
    now = Date.now,
    sleep = delay,
  } = {},
) {
  const deadline = now() + timeoutMs
  const readRecord =
    typeof recordOrReader === 'function'
      ? recordOrReader
      : async () => recordOrReader

  while (now() < deadline) {
    let record
    try {
      record = validateInstanceRecord(await readRecord())
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
      await sleep(Math.min(retryDelayMs, Math.max(0, deadline - now())))
      continue
    }

    const remainingMs = Math.max(1, deadline - now())
    let status
    try {
      status = await postDevQuit(record, remainingMs, requestImpl)
    } catch (error) {
      if (!TRANSIENT_REQUEST_ERRORS.has(error?.code)) {
        throw safeRequestError(error)
      }
      await sleep(Math.min(retryDelayMs, Math.max(0, deadline - now())))
      continue
    }
    if (status === 202) {
      return record
    }
    if (status !== 503) {
      throw new Error(
        `dev quit request returned HTTP ${status ?? 'without a status'}`,
      )
    }
    await sleep(Math.min(retryDelayMs, Math.max(0, deadline - now())))
  }

  throw new Error('timed out waiting for the dev quit request to be accepted')
}

function portAcceptsConnections(port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const finish = (isOpen) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(isOpen)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(Math.max(1, Math.min(1_000, timeoutMs)), () =>
      finish(false),
    )
  })
}

export async function waitForPortClosed(
  port,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    probePort = portAcceptsConnections,
    now = Date.now,
    sleep = delay,
  } = {},
) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('invalid loopback port')
  }
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    const remainingMs = deadline - now()
    if (!(await probePort(port, remainingMs))) {
      return
    }
    await sleep(Math.min(retryDelayMs, Math.max(0, deadline - now())))
  }
  throw new Error('timed out waiting for the dev endpoint to close')
}

export function createMacosShutdownController({
  requestQuit,
  waitForPortClosed: waitForClosed,
  waitForChildExit,
  terminateGroup,
  finalizeGroup = terminateGroup,
  exit,
  report = (message) => console.error(message),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  forceTimeoutMs = 2_000,
  now = Date.now,
}) {
  let signalCount = 0
  let forced = false
  let forcedPromise
  let groupFinalizationPromise

  const remainingBudget = (deadline) => {
    const remaining = deadline - now()
    if (remaining <= 0) {
      throw new Error('timed out waiting for graceful dev shutdown')
    }
    return remaining
  }

  const finalizeOnce = (operation, budget) => {
    groupFinalizationPromise ??= Promise.resolve().then(() => operation(budget))
    return groupFinalizationPromise
  }

  const gracefulShutdown = async () => {
    const deadline = now() + timeoutMs
    try {
      const record = await requestQuit(remainingBudget(deadline))
      if (forced) return false
      await waitForClosed(record.port, remainingBudget(deadline))
      if (forced) return false
      await waitForChildExit(remainingBudget(deadline))
      if (forced) return false
      await finalizeOnce(finalizeGroup, remainingBudget(deadline))
      if (forced) return false
      exit(130)
      return true
    } catch (error) {
      report(
        `Graceful dev shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  }

  return {
    handleSigint() {
      signalCount += 1
      if (signalCount === 1) {
        return gracefulShutdown()
      }
      if (!forcedPromise) {
        forced = true
        forcedPromise = finalizeOnce(terminateGroup, forceTimeoutMs).then(
          () => {
            exit(130)
            return true
          },
        )
      }
      return forcedPromise
    },
  }
}
