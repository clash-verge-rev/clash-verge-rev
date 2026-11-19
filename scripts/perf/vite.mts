import { defineConfig, mergeConfig } from 'vite'

import base from '../../vite.config.mts'
export default mergeConfig(
  base,
  defineConfig({
    root: 'scripts/perf',
    build: { outDir: '../../target/perf/dist', target: 'safari16' },
    resolve: {
      alias: {
        '@tauri-apps/api/core': new URL('./tauri-core-shim.ts', import.meta.url)
          .pathname,
      },
    },
  }),
)
