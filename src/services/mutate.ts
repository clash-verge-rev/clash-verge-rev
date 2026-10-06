import { showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'
import type { AppStoreAction } from '@/store/app-state'

/** Anything a notice call accepts: translation key, ReactNode, or failure payload. */
type MutateNoticeInput = Parameters<typeof showNotice.error>[0]

export interface MutateOptions<T> {
  /** Commands with the same identity execute in request order. */
  id: string
  /** Applied before the command runs; undone by `rollback` on failure. */
  optimistic?: () => void
  /** Restores pre-optimistic state when the command rejects. */
  rollback?: () => void | Promise<void>
  /** Runs after a fulfilled (non-busy) result, e.g. cache merges. */
  onFulfilled?: (value: T) => void
  /** SWR keys revalidated after a fulfilled result. */
  revalidate?: readonly (readonly unknown[] | string)[]
  /** Shown after a fulfilled result (most flows leave this to backend notices). */
  successNotice?: MutateNoticeInput
  /** Shown when the command resolves with `{ status: 'busy' }`. */
  busyNotice?: MutateNoticeInput
  /** `false` suppresses the default error toast. */
  errorNotice?: false | MutateNoticeInput
}

export type MutateResult<T> =
  | { ok: true; value: T }
  | { ok: false; busy: true; value?: T }

/** ValidationOutcome-shaped results report backend-side Busy rejection this way. */
const isBusyOutcome = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { status?: unknown }).status === 'busy'

const inFlight = new Map<string, Promise<void>>()
let storeDispatch: ((action: AppStoreAction) => void) | null = null

/** The app store registers its dispatcher so the funnel can record busy state. */
export const bindStoreDispatch = (
  dispatch: ((action: AppStoreAction) => void) | null,
) => {
  storeDispatch = dispatch
}

/**
 * The single funnel for "user intent → backend command": optimistic apply,
 * invoke through the services layer, Busy handling, failure rollback, and the
 * error toast, in that order, for every mutating call site.
 */
export async function mutate<T>(
  invoke: () => Promise<T>,
  options: MutateOptions<T>,
): Promise<MutateResult<T>> {
  const { id } = options
  const previous = inFlight.get(id)
  let release!: () => void
  const settled = new Promise<void>((resolve) => {
    release = resolve
  })
  inFlight.set(id, settled)
  if (previous) await previous
  storeDispatch?.({ type: 'busy/started', id })

  try {
    options.optimistic?.()
    const value = await invoke()
    if (isBusyOutcome(value)) {
      if (options.busyNotice !== undefined) {
        showNotice.warning(options.busyNotice)
      }
      return { ok: false, busy: true, value }
    }
    options.onFulfilled?.(value)
    if (options.revalidate?.length) {
      await revalidateQueries([...options.revalidate])
    }
    if (options.successNotice !== undefined) {
      showNotice.success(options.successNotice)
    }
    return { ok: true, value }
  } catch (error) {
    await options.rollback?.()
    if (options.errorNotice !== false) {
      showNotice.error(
        options.errorNotice !== undefined ? options.errorNotice : error,
      )
    }
    throw error
  } finally {
    release()
    if (inFlight.get(id) === settled) inFlight.delete(id)
    storeDispatch?.({ type: 'busy/settled', id })
  }
}
