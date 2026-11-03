type Update = { delay: number; elapsed?: number; updatedAt: number }
const listeners = new Map<string, (update: Update) => void>()
const cache = new Map<string, Update>()
let finish: ((update: Update) => void) | undefined
const key = (name: string, group: string) => `${group}:${name}`
export const delayFixture = {
  listeners,
  emit(name: string, group: string, update: Update) {
    cache.set(key(name, group), update)
    listeners.get(key(name, group))?.(update)
  },
  finish(update: Update) {
    if (!finish) throw new Error('No pending delay request')
    finish(update)
    finish = undefined
  },
}
export default {
  setListener(name: string, group: string, listener: (update: Update) => void) {
    listeners.set(key(name, group), listener)
  },
  removeListener(name: string, group: string) {
    listeners.delete(key(name, group))
  },
  getDelayUpdate(name: string, group: string) {
    return cache.get(key(name, group))
  },
  getDelayFix() {
    return -1
  },
  checkDelay() {
    return new Promise<Update>((resolve) => {
      finish = resolve
    })
  },
}
