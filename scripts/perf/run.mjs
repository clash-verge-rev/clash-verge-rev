import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  realpathSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { resolve, dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

import { createTauriCapabilities } from '@wdio/tauri-service'
import { remote } from 'webdriverio'
import { WebSocketServer } from 'ws'

import {
  delta,
  summarize,
  markdown,
  phases,
  roles,
  validStats,
  validWorkload,
  replayValues,
  SCHEMA,
  validObservation,
  validVisibility,
} from './report.mjs'

const { values } = parseArgs({
  args: process.argv.slice(2).filter((v) => v !== '--'),
  options: {
    output: { type: 'string', default: `target/perf/runs/${Date.now()}` },
    binary: { type: 'string', default: 'target/perf/build/clash-verge' },
    repeat: { type: 'string', default: '3' },
    seconds: { type: 'string', default: '20' },
    warmup: { type: 'string', default: '10' },
    'fail-phase': { type: 'string' },
  },
})
const seconds = Number(values.seconds),
  warmup = Number(values.warmup),
  repeat = Number(values.repeat)
const replayMs = 200
if (process.platform !== 'darwin') throw new Error('macOS only')
function readConsole() {
  const consoleState = JSON.parse(
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: execFileSync('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-a']),
      encoding: 'utf8',
    }),
  )
  const locked = consoleState.IOConsoleLocked
  if (typeof locked !== 'boolean')
    throw new Error('Environment unavailable: unknown console lock state')
  return locked
}
function checkConsole() {
  const locked = readConsole()
  if (locked)
    throw new Error(
      'Environment unavailable: an unlocked graphical session is required; window focus is not required',
    )
  return locked
}
const consoleLocked = checkConsole()
if (
  ![seconds, warmup, repeat].every(Number.isFinite) ||
  seconds < 5 ||
  warmup < 2 ||
  repeat < 1 ||
  !Number.isInteger(repeat)
)
  throw new Error('Require seconds >= 5, warmup >= 2, integer repeat >= 1')
const phaseTargets = phases.map(
  (_, i) =>
    Math.ceil(((warmup + 5) * 1000) / replayMs) +
    i * Math.ceil(((seconds + 2) * 1000) / replayMs),
)
if ((phaseTargets[2] * replayMs) / 1000 + seconds + 5 >= 600)
  throw new Error(
    'Total replay including transition allowance must be < 10 minutes',
  )
const binary = realpathSync(values.binary),
  output = resolve(values.output)
const webcontentBinary = realpathSync(
  '/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent',
)
const build = JSON.parse(readFileSync(`${binary}.json`))
const hash = (data) => createHash('sha256').update(data).digest('hex')
if (hash(readFileSync(binary)) !== build.binarySha256)
  throw new Error('Binary does not match build manifest')
try {
  execFileSync('git', ['check-ignore', '-q', '--no-index', output])
} catch {
  throw new Error('Output directory must be Git ignored')
}
mkdirSync(dirname(output), { recursive: true })
mkdirSync(output)
execFileSync('cc', ['-O2', 'scripts/perf/sample.c', '-o', `${output}/sample`])
const command = (name, args) =>
  execFileSync(name, args, { encoding: 'utf8' }).trim()
const report = {
  schema: SCHEMA,
  build,
  contract: {
    scenario: 'traffic',
    replayMs,
    consoleLocked,
    method: 'mach-rusage-v0-seconds/rss-bytes-v1',
    mode: build.mode,
    buildSettingsSha256: build.buildSettingsSha256,
    buildEnvironment: build.buildEnvironment,
    toolchain: build.toolchain,
    platform: command('sw_vers', []),
    machine: command('sysctl', ['-n', 'hw.model']),
    arch: process.arch,
    host: hash(command('scutil', ['--get', 'LocalHostName'])),
    hardware: command('sysctl', ['hw.ncpu', 'hw.memsize']),
    power: command('pmset', ['-g', 'custom']),
    powerSource: command('pmset', ['-g', 'batt']).split('\n')[0],
    webkit: command('defaults', [
      'read',
      '/System/Library/Frameworks/WebKit.framework/Resources/Info',
      'CFBundleVersion',
    ]),
    seconds,
    warmup,
    phaseTargets,
    transitionSeconds: 2,
    readinessAllowanceSeconds: 5,
    intervalMs: 1000,
    window: [1000, 700],
    windowPolicy: 'nonactivating-top-click-through-v1',
    rangeMinutes: 10,
    replay:
      'deterministic-v1, 5Hz, no prefill, append boundary, default bezier, blur pause false',
    automation:
      'wdio plugin 1.3.0; 20Hz macOS runloop pump plus one WebDriver observation/second',
  },
  runs: [],
}
report.units = {
  time: 'monotonic milliseconds',
  cpu: 'cumulative CPU seconds',
  percent: 'one CPU core = 100%',
  rss: 'resident size bytes',
  start: 'Mach process start ticks',
}
report.monotonicOriginEpochMs = performance.timeOrigin
report.harnessSha256 = hash(
  ['run.mjs', 'report.mjs', 'sample.c']
    .map((p) => readFileSync(`scripts/perf/${p}`))
    .join('\n'),
)
let interrupted = false
const abort = new AbortController()
const pause = (ms) => sleep(ms, undefined, { signal: abort.signal })
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true
    abort.abort()
  })
const assert = (value, reason) => {
  if (!value) throw new Error(reason)
}
const drawn = (s) => s.now >= s.draw && s.now - s.draw < 2500
const marker = (s) => ({
  ...s,
  pixelsSha256: hash(s.pixels),
  pixels: undefined,
  ua: undefined,
  token: undefined,
})
async function freePort() {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}
for (let iteration = 0; iteration < repeat && !interrupted; iteration++) {
  const initialLocked = checkConsole()
  const token = randomUUID(),
    port = await freePort()
  const run = {
    token,
    ok: false,
    samples: [],
    observations: [],
    consoleStates: [
      { name: 'initial', locked: initialLocked, time: Date.now() },
    ],
    marks: [],
    stats: {},
    cleanup: {},
    replay: { sent: 0, maxLateMs: 0 },
  }
  report.runs.push(run)
  const replay = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise((done) => replay.on('listening', done))
  let sequence = 0,
    replayStarted,
    timer
  replay.on('connection', () => {
    if (replayStarted !== undefined) {
      run.replay.error = 'unexpected replay reconnection'
      clearTimeout(timer)
      return
    }
    replayStarted = performance.now()
    timer = setTimeout(send, replayMs)
  })
  const deadlineIndex = () =>
    Math.floor((performance.now() - replayStarted) / replayMs)
  function send() {
    const deadline = replayStarted + (sequence + 1) * replayMs
    const late = performance.now() - deadline
    if (late < 0) {
      timer = setTimeout(send, Math.ceil(-late))
      return
    }
    run.replay.maxLateMs = Math.max(run.replay.maxLateMs, late)
    if (late >= replayMs) {
      run.replay.error = `replay source missed a complete ${replayMs} ms period`
      return
    }
    sequence++
    run.replay.sent = sequence
    const timestamp = Date.now()
    const point = JSON.stringify({
      sequence,
      timestamp,
      ...replayValues(sequence),
    })
    for (const socket of replay.clients)
      if (socket.readyState === 1) socket.send(point)
    timer = setTimeout(
      send,
      Math.max(
        0,
        replayStarted + (sequence + 1) * replayMs - performance.now(),
      ),
    )
  }
  const log = openSync(`${output}/${iteration + 1}.log`, 'w')
  const child = spawn(binary, [], {
    env: {
      ...process.env,
      PERF_TOKEN: token,
      PERF_REPLAY_PORT: String(replay.address().port),
      TAURI_WEBDRIVER_PORT: String(port),
    },
    stdio: ['ignore', log, log],
  })
  closeSync(log)
  let browser, childError, previous, mainStart
  const identities = {}
  child.on('error', (error) => {
    childError = error
  })
  const exited = new Promise((done) => child.once('exit', done))
  const alive = () =>
    !childError && child.exitCode === null && child.signalCode === null
  const collect = (pids) =>
    command(`${output}/sample`, pids.map(String))
      .split('\n')
      .map((line) => {
        const [pid, start, cpu, rss, ...path] = line.split(' ')
        return {
          pid: Number(pid),
          start,
          cpu: Number(cpu),
          rss: Number(rss),
          path: path.join(' '),
          time: performance.now(),
        }
      })
  const identify = (role, row) => {
    assert(
      row.path === (role === 'main' ? binary : webcontentBinary),
      `unexpected ${role} process executable: ${row.path}`,
    )
    assert(
      BigInt(row.start) >= BigInt(mainStart),
      'process predates owned application',
    )
    const identity = `${row.pid}/${row.start}`
    assert(
      !identities[role] || identities[role] === identity,
      'process identity changed during scenario',
    )
    identities[role] = identity
  }
  const state = async (action = 'state', pixels = false) =>
    browser.execute(
      async (action, pixels) => {
        const native = await window.__TAURI_INTERNALS__.invoke('perf_state', {
          action,
        })
        const canvas = document.querySelector('canvas')
        return {
          ...native,
          now: Date.now(),
          hidden: document.hidden,
          focused: document.hasFocus(),
          received: Number(document.documentElement.dataset.perfReceived),
          source: Number(document.documentElement.dataset.perfSourceTime),
          gaps: Number(document.documentElement.dataset.perfGaps),
          worker: Number(document.documentElement.dataset.perfWorker),
          points: Number(document.documentElement.dataset.perfPoints),
          lastUp: Number(document.documentElement.dataset.perfLastUp),
          lastDown: Number(document.documentElement.dataset.perfLastDown),
          draw: Number(canvas?.dataset.perfDraw),
          pixels: pixels ? canvas?.toDataURL() : null,
          ua: navigator.userAgent,
        }
      },
      action,
      pixels,
    )
  const checked = async (action, pixels) => {
    assert(!interrupted, 'interrupted')
    assert(!run.replay.error, run.replay.error)
    assert(
      alive(),
      `owned app exited: ${childError ?? child.exitCode ?? child.signalCode}`,
    )
    const value = await state(action, pixels)
    assert(!run.replay.error, run.replay.error)
    run.lastObservation = { ...value, pixels: undefined, ua: undefined }
    assert(
      value.token === token && value.main === child.pid,
      'instance identity mismatch',
    )
    if (!identities.webview) {
      run.initialAttribution = collect([value.webview])[0]
      identify('webview', run.initialAttribution)
    }
    assert(
      value.nativeFocused === false && value.appActive === false,
      'measurement window unexpectedly activated',
    )
    assert(
      value.top === true && value.clickThrough === true,
      'measurement window must be natively topmost and click-through',
    )
    return value
  }
  try {
    mainStart = collect([child.pid])[0].start
    const deadline = Date.now() + 30000
    while (true) {
      assert(
        Date.now() < deadline && !interrupted && alive(),
        'embedded WebDriver readiness deadline or app exit',
      )
      try {
        if (
          (
            await fetch(`http://127.0.0.1:${port}/status`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        )
          break
      } catch {}
      await pause(100)
    }
    const listener = command('lsof', [
      '-nP',
      '-a',
      '-p',
      String(child.pid),
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
    ])
    assert(
      listener.includes(`127.0.0.1:${port}`) && !listener.includes(`*:${port}`),
      'driver must belong to this app and bind loopback',
    )
    const capabilities = createTauriCapabilities(binary)
    delete capabilities['wdio:tauriServiceOptions']
    browser = await remote({
      hostname: '127.0.0.1',
      port,
      capabilities,
      logLevel: 'error',
      connectionRetryCount: 0,
      connectionRetryTimeout: 5000,
    })
    const handles = await browser.getWindowHandles()
    assert(handles.length === 1, 'expected exactly one measurement WebView')
    await browser.switchToWindow(handles[0])
    // Replay's parent effect starts the socket after the graph installs its listeners.
    await browser.waitUntil(
      async () => {
        const s = await checked()
        return (
          validWorkload(s) &&
          s.received >= 3 &&
          s.now >= s.worker &&
          s.now - s.worker < 2500
        )
      },
      {
        timeout: 15000,
        interval: 100,
        timeoutMsg: 'traffic effects/Worker not ready before show',
      },
    )
    run.initialData = run.lastObservation
    await checked('show')
    await browser.waitUntil(
      async () => {
        const s = await checked()
        return validObservation({ phase: 'foreground', ...s })
      },
      {
        timeout: 15000,
        interval: 250,
        timeoutMsg: 'traffic data path/page not ready',
      },
    )
    run.userAgent = (await checked()).ua
    run.backgroundLoad = command('sysctl', ['-n', 'vm.loadavg'])
    const viewport = await browser.execute(() => [
      innerWidth,
      innerHeight,
      devicePixelRatio,
    ])
    run.viewport = { dom: viewport, driver: await browser.getWindowRect() }
    assert(
      run.viewport.driver.width / viewport[2] === 1000 &&
        run.viewport.driver.height / viewport[2] === 700 &&
        viewport[0] === 1000 &&
        viewport[1] > 0 &&
        viewport[1] <= 700,
      `unexpected window dimensions: ${JSON.stringify(run.viewport)}`,
    )
    assert(
      !report.contract.viewport ||
        JSON.stringify(report.contract.viewport) === JSON.stringify(viewport),
      'viewport changed between runs',
    )
    report.contract.viewport = viewport
    run.marks.push({ name: 'ready', time: Date.now() })
    const readyAt = performance.now()
    assert(
      phaseTargets[0] - (await checked()).received >=
        (warmup * 1000) / replayMs,
      'readiness exceeded fixed replay allowance',
    )
    for (const phase of phases) {
      run.consoleStates.push({
        name: phase,
        locked: readConsole(),
        time: Date.now(),
      })
      const operation = performance.now()
      let s = await checked(phase === 'hidden' ? 'hide' : 'show', true)
      assert(
        s.visible === (phase !== 'hidden'),
        `${phase}: native visibility mismatch`,
      )
      const beforeDraw = s.draw
      await browser.waitUntil(
        async () => {
          s = await checked('state', true)
          return (
            validVisibility({ phase, ...s }) &&
            (phase === 'hidden' || (s.draw > beforeDraw && drawn(s)))
          )
        },
        {
          timeout: 5000,
          interval: 100,
          timeoutMsg: `${phase}: window/Canvas readiness deadline`,
        },
      )
      const operationMs = performance.now() - operation
      const target = phaseTargets[phases.indexOf(phase)]
      await browser.waitUntil(
        async () => {
          s = await checked('state', true)
          assert(
            s.received <= target,
            `${phase}: missed replay anchor ${target}`,
          )
          return s.received === target
        },
        {
          timeout: Math.max(1000, (target - s.received) * replayMs + 1000),
          interval: 50,
          timeoutMsg: `${phase}: replay anchor deadline`,
        },
      )
      assert(
        validObservation({ phase, ...s }),
        `${phase}: invalid traffic observation`,
      )
      const first = s,
        start = performance.now(),
        firstIndex = deadlineIndex(),
        phaseEpoch = Date.now()
      if (phase === 'foreground') {
        run.actualWarmupMs = start - readyAt
        assert(
          run.actualWarmupMs >= warmup * 1000,
          'insufficient actual warmup',
        )
      }
      run.marks.push({
        name: phase,
        time: phaseEpoch,
        operationMs,
        transitionMs: start - operation,
        target,
        ...marker(s),
        deadlineIndex: firstIndex,
        senderSent: run.replay.sent,
      })
      previous = {}
      if (values['fail-phase'] === phase)
        throw new Error(`injected failure at ${phase}`)
      while (performance.now() - start < seconds * 1000) {
        const tick = performance.now()
        s = await checked()
        run.observations.push({ phase, ...run.lastObservation })
        assert(
          validObservation({ phase, ...s }),
          `${phase}: invalid visibility, workload or freshness`,
        )
        assert(
          performance.now() - replayStarted < 600000,
          'replay exceeded raw history window',
        )
        const samples = collect(roles.map((role) => s[role]))
        run.attribution = {
          main: s.main,
          webview: s.webview,
          observed: samples,
        }
        for (let i = 0; i < roles.length; i++) {
          const row = { ...samples[i], phase, role: roles[i] }
          identify(row.role, row)
          row.percent = delta(previous[row.role], row)
          row.cpuDelta =
            row.percent === null ? null : row.cpu - previous[row.role].cpu
          run.samples.push(row)
          previous[row.role] = row
        }
        await pause(Math.max(0, 1000 - (performance.now() - tick)))
      }
      s = await checked('state', true)
      const endIndex = deadlineIndex()
      const expected = endIndex - firstIndex
      assert(
        validObservation({ phase, ...s }) &&
          s.worker > first.worker &&
          Math.abs(s.received - first.received - expected) <= 2,
        `${phase}: unstable or lost workload`,
      )
      if (phase !== 'hidden')
        assert(
          s.draw > first.draw && s.pixels !== first.pixels,
          `${phase}: Canvas did not render fresh data`,
        )
      run.marks.push({
        name: `${phase}:end`,
        time: s.now,
        ...marker(s),
        deadlineIndex: endIndex,
        senderSent: run.replay.sent,
      })
      run.consoleStates.push({
        name: `${phase}:end`,
        locked: readConsole(),
        time: Date.now(),
      })
    }
    run.stats = summarize(run.samples, seconds)
    assert(
      validStats(run.stats),
      'insufficient coverage or process discontinuity',
    )
    run.ok = true
  } catch (error) {
    run.error = String(error)
    process.exitCode = 1
  } finally {
    await browser?.deleteSession().catch(() => {})
    try {
      if (alive() && collect([child.pid])[0].start === mainStart) {
        child.kill('SIGTERM')
        await Promise.race([exited, sleep(5000)])
        if (alive() && collect([child.pid])[0].start === mainStart) {
          child.kill('SIGKILL')
          await Promise.race([exited, sleep(2000)])
        }
      }
    } catch (error) {
      run.cleanup.error = String(error)
    }
    clearTimeout(timer)
    for (const socket of replay.clients) socket.terminate()
    await new Promise((done) => replay.close(done))
    run.cleanup.mainExited =
      child.exitCode !== null || child.signalCode !== null
    if (identities.webview) {
      const [pid, start] = identities.webview.split('/')
      const remains = () => {
        try {
          return collect([pid])[0].start === start
        } catch {
          return false
        }
      }
      const deadline = Date.now() + 5000
      while (remains() && Date.now() < deadline) await sleep(100)
      run.cleanup.webviewExited = !remains()
    }
    try {
      await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(500),
      })
      run.cleanup.driverClosed = false
    } catch {
      run.cleanup.driverClosed = true
    }
    if (
      !run.cleanup.mainExited ||
      !run.cleanup.driverClosed ||
      run.cleanup.webviewExited === false
    ) {
      run.ok = false
      run.error = `${run.error ?? ''} cleanup failed`
      process.exitCode = 1
    }
    run.stats = summarize(run.samples, seconds)
    writeFileSync(
      `${output}/${iteration + 1}.json`,
      JSON.stringify(run, null, 2),
    )
    const columns = [
      'phase',
      'role',
      'time',
      'pid',
      'start',
      'cpu',
      'percent',
      'rss',
    ]
    writeFileSync(
      `${output}/${iteration + 1}.csv`,
      [
        columns.join(','),
        ...run.samples.map((r) =>
          columns.map((c) => r[c] ?? 'unavailable').join(','),
        ),
      ].join('\n'),
    )
    writeFileSync(`${output}/summary.json`, JSON.stringify(report, null, 2))
    writeFileSync(`${output}/report.md`, markdown(report))
  }
  console.log(`Run ${iteration + 1}: ${run.ok ? 'passed' : run.error}`)
}
console.log(`Reports: ${output}`)
