import { layer, scenario, startReplay } from './replay'

if (scenario === 'traffic') {
  await import('./traffic')
} else {
  const root = document.getElementById('root')!
  document.body.style.cssText = 'margin:0;font:14px -apple-system,sans-serif'
  root.style.cssText = 'width:1000px;height:700px;overflow:hidden'
  new MutationObserver(() => {
    document.documentElement.dataset.perfDraw = String(Date.now())
  }).observe(root, { childList: true, characterData: true, subtree: true })
  window.addEventListener('error', (event) => {
    document.documentElement.dataset.perfError = event.message
  })
  window.addEventListener('unhandledrejection', (event) => {
    document.documentElement.dataset.perfError = String(event.reason)
  })
  if (layer === 'dom') {
    const { mount } = await import('./minimal')
    mount(root)
  } else {
    if (layer === 'page') {
      const { installAdapter } = await import('./adapter')
      installAdapter()
    }
    await import('./scenes')
  }
  startReplay()
}
