import path from 'node:path'

import { defineConfig } from 'vite'

import config from './vite.config.mts'

export default defineConfig({
  ...config,
  build: {
    ...config.build,
    outDir: '../dist-quick-panel',
    rollupOptions: {
      input: path.resolve('src/quick-panel.html'),
    },
  },
})
