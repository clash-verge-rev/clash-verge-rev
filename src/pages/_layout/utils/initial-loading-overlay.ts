let removed = false

export const hideInitialOverlay = (): number | undefined => {
  if (removed) return undefined

  const overlay = document.getElementById('initial-loading-overlay')
  if (!overlay) {
    removed = true
    return undefined
  }

  removed = true
  overlay.dataset.hidden = 'true'

  const timer = window.setTimeout(() => overlay.remove(), 200)
  return timer
}
