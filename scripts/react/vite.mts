import path from 'node:path'

import { normalizePath, type Plugin } from 'vite'

export function reactDiagnostics(mode: string | undefined): Plugin[] {
  if (!mode) return []
  return [
    {
      name: 'react-diagnostics',
      enforce: 'pre',
      apply: 'serve',
      config() {
        if (mode !== 'profiler')
          throw new Error(`Unknown CVR_REACT_DIAGNOSTICS mode: ${mode}`)
      },
      transform(code, id) {
        if (id !== normalizePath(path.resolve('src/main.tsx'))) return
        const open = '<React.StrictMode>'
        const close = '</React.StrictMode>'
        if (!code.includes(open) || !code.includes(close)) {
          throw new Error('React profiling entry no longer matches main.tsx')
        }
        return {
          code: `import { Profiler } from 'react'\nimport { recordRender } from '../scripts/react/profiler'\n${code}`
            .replace(open, `<Profiler id="app" onRender={recordRender}>${open}`)
            .replace(close, `${close}</Profiler>`),
          map: null,
        }
      },
    },
  ]
}
