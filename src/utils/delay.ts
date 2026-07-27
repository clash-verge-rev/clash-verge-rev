/**
 * What a delay number means, before anyone decides how to draw it.
 *
 * The core reports latency through a single number that encodes several non-measurements:
 * sentinels for "never tested" and "testing now", zero and large values for timeouts, and
 * absurd values for errors. Every surface agreed on those rules and restated them; they are
 * stated once here.
 *
 * How a *measured* delay is graded — fast, slow, and the thresholds between — is deliberately
 * not here. A three-colour chip and a four-bar signal icon draw different distinctions, and
 * flattening them would be inventing a UI decision rather than removing a duplicate one.
 */

/** The delay above which the core is considered to have timed out. */
export const DEFAULT_DELAY_TIMEOUT = 10000

/** The value the core reports for a node whose test is in flight. */
const TESTING = -2

/** Above this, the number is not a latency at all. */
const IMPLAUSIBLE_DELAY = 1e5

export type DelayState =
  | 'testing'
  | 'untested'
  | 'error'
  | 'timeout'
  /** An actual latency measurement, in milliseconds. */
  | 'measured'

export const classifyDelay = (
  delay: number,
  timeout: number = DEFAULT_DELAY_TIMEOUT,
): DelayState => {
  if (!Number.isFinite(delay)) return 'untested'
  if (delay === TESTING) return 'testing'
  if (delay < 0) return 'untested'
  if (delay > IMPLAUSIBLE_DELAY) return 'error'
  if (delay === 0 || delay >= timeout) return 'timeout'
  return 'measured'
}

/**
 * The order delays sort in: measured first and fastest first, then timeouts, then errors,
 * then everything we have no measurement for.
 *
 * Ranks are compared before values so that a non-measurement can never sort ahead of a real
 * one just because its sentinel happens to be a small number.
 */
const rankOf = (state: DelayState): number => {
  switch (state) {
    case 'measured':
      return 0
    case 'timeout':
      return 1
    case 'error':
      return 2
    case 'testing':
      return 3
    case 'untested':
      return 4
  }
}

/** A total order over delays, for sorting a proxy list fastest-first. */
export const compareByDelay = (
  a: number,
  b: number,
  timeout: number = DEFAULT_DELAY_TIMEOUT,
): number => {
  const [aState, bState] = [
    classifyDelay(a, timeout),
    classifyDelay(b, timeout),
  ]
  const rankDifference = rankOf(aState) - rankOf(bState)
  if (rankDifference !== 0) return rankDifference

  // Within a rank, only a real measurement has a meaningful magnitude.
  if (aState !== 'measured') return 0
  return a - b
}
