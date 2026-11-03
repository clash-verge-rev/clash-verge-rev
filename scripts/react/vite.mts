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
        if (mode !== 'profiler' && mode !== 'wdyr')
          throw new Error(`Unknown CVR_REACT_DIAGNOSTICS mode: ${mode}`)
        return {
          cacheDir: path.resolve('node_modules/.vite', mode),
          ...(mode === 'wdyr'
            ? {
                oxc: {
                  jsx: {
                    importSource: '@welldone-software/why-did-you-render',
                  },
                },
                optimizeDeps: {
                  include: [
                    '@welldone-software/why-did-you-render',
                    '@welldone-software/why-did-you-render/jsx-dev-runtime',
                  ],
                },
              }
            : {}),
        }
      },
      transformIndexHtml(html) {
        if (mode !== 'wdyr') return html
        const entry = 'src="./main.tsx"'
        if (!html.includes(entry))
          throw new Error('WDYR entry no longer matches index.html')
        return html.replace(
          entry,
          `src="/@fs/${normalizePath(path.resolve('scripts/react/wdyr.ts'))}"`,
        )
      },
      transform(code, id) {
        if (mode !== 'profiler') return
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
