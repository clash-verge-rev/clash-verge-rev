import { startReplay } from './replay'

// Thin loader: error handlers must precede scene module evaluation so any
// startup failure surfaces in perfError.
const data = document.documentElement.dataset
window.addEventListener('error', (event) => {
  data.perfError = event.message
})
window.addEventListener('unhandledrejection', (event) => {
  data.perfError = String(event.reason)
})

data.perfStage = 'loader'
await import('./proxy-scene')
data.perfStage = 'scene'
startReplay()
data.perfStage = 'replay'
