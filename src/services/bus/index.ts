import { emit } from '@tauri-apps/api/event'

import { TEST_ALL_EVENT } from './create-bus-handlers'

export { useEventBus } from './use-event-bus'

/** The only emitter of the frontend-internal test-all event. */
export const emitTestAll = () => {
  void emit(TEST_ALL_EVENT)
}
