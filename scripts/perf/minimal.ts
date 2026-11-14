import { scenario, subscribe } from './replay'

export function mount(root: HTMLElement) {
  const rows = Array.from({ length: 20 }, () => {
    const row = document.createElement('div')
    row.style.cssText = 'height:32px;white-space:nowrap;overflow:hidden'
    root.appendChild(row)
    return row
  })
  subscribe(({ payload }) => {
    const texts =
      scenario === 'logs'
        ? (payload as ILogItem[]).map((log) => log.payload)
        : (payload as IConnections).connections.map(
            (connection) => connection.metadata.host,
          )
    rows.forEach((row, index) => {
      row.textContent = texts[index % texts.length] ?? ''
    })
  })
}
