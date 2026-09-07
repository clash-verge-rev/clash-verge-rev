import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { test } from 'node:test'

import {
  compare,
  delta,
  phases,
  roles,
  quantile,
  summarize,
  validWorkload,
  replayValues,
  SCHEMA,
  validVisibility,
} from './report.mjs'
const latest = (sequence) => {
  const { up, down } = replayValues(sequence)
  return { lastUp: up, lastDown: down }
}
const observation = (phase, now) => ({
  phase,
  now,
  source: now - 100,
  worker: now - 100,
  draw: now - 100,
  visible: phase !== 'hidden',
  hidden: phase === 'hidden',
  focused: false,
  nativeFocused: false,
  appActive: false,
  top: true,
  clickThrough: true,
})
const rows = phases.flatMap((phase, phaseIndex) =>
  roles.flatMap((role) =>
    Array.from({ length: 5 }, (_, i) => ({
      phase,
      role,
      pid: role === 'main' ? 1 : 2,
      start: '1',
      time: (phaseIndex * 5 + i) * 1000,
      cpu: (phaseIndex * 5 + i) / 10,
      rss: 100 + i,
    })),
  ),
)
const run = {
  ok: true,
  samples: rows,
  cleanup: { mainExited: true, driverClosed: true, webviewExited: true },
  replay: { sent: 130, maxLateMs: 10 },
  actualWarmupMs: 3000,
  observations: phases.map((phase, i) => ({
    ...observation(phase, 2000 + i * 10000),
    received: 35 + i * 35,
    points: 34 + i * 35,
    gaps: 0,
    ...latest(34 + i * 35),
  })),
  marks: [
    { name: 'ready', time: 1 },
    ...phases.flatMap((name, i) => [
      {
        name,
        target: 35 + i * 35,
        deadlineIndex: 35 + i * 35,
        senderSent: 35 + i * 35,
        received: 35 + i * 35,
        points: 34 + i * 35,
        ...latest(34 + i * 35),
        gaps: 0,
        time: 1000 + i * 10000,
        ...observation(name, 1000 + i * 10000),
        pixelsSha256: 'a'.repeat(64),
      },
      {
        name: `${name}:end`,
        deadlineIndex: 60 + i * 35,
        senderSent: 60 + i * 35,
        received: 60 + i * 35,
        points: 59 + i * 35,
        ...latest(59 + i * 35),
        gaps: 0,
        time: 6000 + i * 10000,
        ...observation(name, 6000 + i * 10000),
        pixelsSha256: 'b'.repeat(64),
      },
    ]),
  ],
}
run.consoleStates = run.marks.map((m, i) => ({
  name: i ? m.name : 'initial',
  time: m.time,
  locked: false,
}))
const baseline = {
  schema: SCHEMA,
  harnessSha256: 'fixture-harness',
  build: {
    head: 'fixture-head',
    dirty: '',
    sourceSha256: 'fixture-source',
    binarySha256: 'same',
    frontendSha256: 'fixture-assets',
    buildSettingsSha256: 'fixture-settings',
    mode: 'release',
    buildCommand: 'fixture-build',
    binary: '/fixture/app',
    toolchain: 'fixture-tools',
    buildEnvironment: {},
  },
  contract: {
    scenario: 'traffic',
    replayMs: 200,
    consoleLocked: false,
    windowPolicy: 'nonactivating-top-click-through-v1',
    seconds: 5,
    warmup: 2,
    phaseTargets: [35, 70, 105],
    transitionSeconds: 2,
    readinessAllowanceSeconds: 5,
    intervalMs: 1000,
    rangeMinutes: 10,
    window: [1000, 700],
    viewport: [1000, 668, 2],
    method: 'fixture-method',
    mode: 'release',
    toolchain: 'fixture-tools',
    buildSettingsSha256: 'fixture-settings',
    platform: 'macOS',
    machine: 'fixture-model',
    arch: 'arm64',
    host: 'fixture-host',
    hardware: 'fixture-hardware',
    power: 'fixture-power',
    powerSource: 'AC',
    webkit: 'fixture-webkit',
    replay: 'fixture-5Hz',
    automation: 'fixture-wdio',
    buildEnvironment: {},
  },
  runs: [run, run, run],
}
test('quantiles, CPU units, first observation and PID reuse', () => {
  assert.equal(quantile([0, 10, 20], 0.95), 19)
  assert.equal(delta(undefined, rows[0]), null)
  assert.equal(delta(rows[0], rows[1]), 10)
  assert.equal(delta(rows[0], { ...rows[1], start: '2' }), null)
  assert.equal(delta(rows[0], { ...rows[1], time: NaN }), null)
  assert.equal(summarize(rows, 5)['hidden/main'].cpuMean, 10)
  assert.equal(summarize([], 5)['hidden/main'].cpuSeconds, null)
})
test('report schema: A/A, failed, incomparable and corrupt samples', () => {
  assert.equal(compare(baseline, baseline).kind, 'A/A')
  assert.equal(
    compare(baseline, { ...baseline, schema: 'old' }).verdict,
    'invalid',
  )
  for (const change of [
    { appActive: true },
    { nativeFocused: true },
    { top: false },
    { top: undefined },
    { clickThrough: false },
    { clickThrough: undefined },
    { hidden: true },
    { worker: 3000 },
    { now: 6000 },
    { draw: 3000 },
    { worker: null },
  ]) {
    const invalid = structuredClone(baseline)
    Object.assign(invalid.runs[0].observations[0], change)
    assert.equal(compare(baseline, invalid).verdict, 'invalid')
  }
  for (const key of ['draw', 'pixelsSha256']) {
    const stalled = structuredClone(baseline)
    stalled.runs[0].marks[2][key] = stalled.runs[0].marks[1][key]
    assert.equal(compare(baseline, stalled).verdict, 'invalid')
  }
  const missingPhase = structuredClone(baseline)
  missingPhase.runs[0].observations.pop()
  assert.equal(compare(baseline, missingPhase).verdict, 'invalid')
  const consoleDrift = structuredClone(baseline)
  consoleDrift.runs[0].consoleStates[3].locked = true
  assert.equal(compare(baseline, consoleDrift).verdict, 'incomparable')
  consoleDrift.runs[0].consoleStates[3].locked = null
  assert.equal(compare(baseline, consoleDrift).verdict, 'invalid')
  assert.equal(
    validVisibility({ phase: 'restored', visible: true, hidden: true }),
    false,
  )
  const missedPeriod = structuredClone(baseline)
  missedPeriod.runs[0].replay.maxLateMs = 200
  assert.equal(compare(baseline, missedPeriod).verdict, 'invalid')
  const delayed = {
    received: 100,
    points: 97,
    gaps: 0,
    lastUp: 270000,
    lastDown: 640000,
  }
  assert.equal(validWorkload(delayed), true)
  assert.equal(validWorkload(null), false)
  assert.equal(validWorkload({ ...delayed, points: 96 }), false)
  assert.equal(validWorkload({ ...delayed, points: 98 }), false)
  assert.equal(validWorkload({ ...delayed, received: 157 }), false)
  assert.equal(validWorkload({ ...delayed, lastDown: 660000 }), false)
  const missedAnchor = structuredClone(baseline)
  missedAnchor.runs[0].marks[1].received++
  assert.equal(compare(baseline, missedAnchor).verdict, 'invalid')
  const droppedInputs = structuredClone(baseline)
  const end = droppedInputs.runs[0].marks[2]
  end.received -= 10
  end.points -= 10
  Object.assign(end, latest(end.points))
  assert.equal(compare(droppedInputs, droppedInputs).verdict, 'invalid')
  const workerLag = structuredClone(baseline)
  workerLag.runs[0].observations[0].points -= 3
  assert.equal(compare(baseline, workerLag).verdict, 'invalid')
  const inputDrift = structuredClone(baseline)
  inputDrift.runs = baseline.runs.map((r) => structuredClone(r))
  inputDrift.runs[0].marks[2].received += 3
  inputDrift.runs[0].marks[2].points += 3
  inputDrift.runs[0].marks[2].deadlineIndex += 3
  inputDrift.runs[0].marks[2].senderSent += 3
  Object.assign(
    inputDrift.runs[0].marks[2],
    latest(inputDrift.runs[0].marks[2].points),
  )
  assert.equal(compare(baseline, inputDrift).verdict, 'incomparable')
  const snapshotPhase = structuredClone(baseline)
  snapshotPhase.runs[0].marks[2].points++
  Object.assign(
    snapshotPhase.runs[0].marks[2],
    latest(snapshotPhase.runs[0].marks[2].points),
  )
  assert.equal(compare(baseline, snapshotPhase).kind, 'A/A')
  const changedSettings = structuredClone(baseline)
  changedSettings.build.buildSettingsSha256 =
    changedSettings.contract.buildSettingsSha256 = 'changed-settings'
  assert.equal(compare(baseline, changedSettings).verdict, 'incomparable')
  assert.equal(
    compare(baseline, { ...baseline, harnessSha256: 'changed' }).verdict,
    'incomparable',
  )
  assert.equal(
    compare(baseline, {
      ...baseline,
      contract: { ...baseline.contract, seconds: 6 },
    }).verdict,
    'incomparable',
  )
  assert.equal(
    compare(baseline, { ...baseline, runs: [{ ...run, ok: false }] }).verdict,
    'invalid',
  )
  const corrupt = structuredClone(baseline)
  corrupt.runs[0].samples[1].time = 0
  assert.equal(compare(baseline, corrupt).verdict, 'invalid')
  const shifted = structuredClone(baseline)
  shifted.runs[0].samples
    .filter((s) => s.phase === 'hidden')
    .forEach((s) => {
      s.time -= 5000
    })
  assert.equal(compare(baseline, shifted).verdict, 'invalid')
  const badMarks = structuredClone(baseline)
  badMarks.runs[0].marks.forEach((m) => {
    m.time = -1
  })
  assert.equal(compare(baseline, badMarks).verdict, 'invalid')
  const clustered = structuredClone(baseline)
  clustered.runs[0].samples.forEach((s) => {
    s.time /= 1000
  })
  assert.equal(compare(baseline, clustered).verdict, 'invalid')
  for (const [section, key] of [
    ['contract', 'platform'],
    ['build', 'sourceSha256'],
  ]) {
    const missing = structuredClone(baseline)
    delete missing[section][key]
    assert.equal(compare(missing, missing).verdict, 'invalid')
  }
  assert.equal(
    compare(baseline, {
      ...baseline,
      contract: { ...baseline.contract, platform: 'other-macOS' },
    }).verdict,
    'incomparable',
  )
  for (const malformed of [
    null,
    {},
    { runs: [null] },
    { ...baseline, runs: [{ ...run, samples: null }] },
  ])
    assert.equal(compare(baseline, malformed).verdict, 'invalid')
  const noisy = structuredClone(baseline)
  noisy.runs = baseline.runs.map((r) => structuredClone(r))
  noisy.build.binarySha256 = 'different'
  noisy.runs.forEach((r, i) =>
    r.samples.forEach((s) => {
      s.cpu *= [0.1, 0.2, 10][i]
    }),
  )
  assert.equal(
    compare(baseline, noisy, 5).metrics['foreground/webview/cpuMean'].verdict,
    'inconclusive',
  )
})
test('macOS collector agrees with process.cpuUsage on a busy owned process', {
  skip: process.platform !== 'darwin',
}, () => {
  mkdirSync('target/perf', { recursive: true })
  execFileSync('cc', [
    '-Wall',
    '-Wextra',
    '-Werror',
    'scripts/perf/sample.c',
    '-o',
    'target/perf/test-sample',
  ])
  const sample = () =>
    Number(
      execFileSync('target/perf/test-sample', [String(process.pid)], {
        encoding: 'utf8',
      }).split(' ')[2],
    )
  const first = sample(),
    cpu = process.cpuUsage(),
    start = performance.now()
  while (performance.now() - start < 500) Math.sqrt(Math.random())
  const used = process.cpuUsage(cpu),
    measured = sample() - first
  assert.ok(Math.abs(measured - (used.user + used.system) / 1e6) < 0.05)
})
