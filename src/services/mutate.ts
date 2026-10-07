import { showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'

/** Anything a notice call accepts: translation key, ReactNode, or failure payload. */
type MutateNoticeInput = Parameters<typeof showNotice.error>[0]

export interface MutateOptions<T> {
  /** Commands with the same identity execute in request order. */
  id: string
  /** Runs after a fulfilled (non-busy) result, e.g. cache merges. */
  onFulfilled?: (value: T) => void
  /** SWR keys revalidated after a fulfilled result. */
  revalidate?: readonly (readonly unknown[] | string)[]
  /** Shown after a fulfilled result (most flows leave this to backend notices). */
  successNotice?: MutateNoticeInput
  /** `false` suppresses the default error toast. */
  errorNotice?: false
}

export type MutateResult<T> = { ok: true; value: T } | { ok: false; value: T }

/** ValidationOutcome-shaped results report backend-side Busy rejection this way. */
const isBusyOutcome = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  (value as { status?: unknown }).status === 'busy'

const inFlight = new Map<string, Promise<void>>()
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

  try {
    const value = await invoke()
    if (isBusyOutcome(value)) {
      return { ok: false, value }
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
    if (options.errorNotice !== false) {
      showNotice.error(error)
    }
    throw error
  } finally {
    release()
    if (inFlight.get(id) === settled) inFlight.delete(id)
  }
}
