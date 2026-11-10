import path from 'node:path'

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

const svgPlugin = svgr()
const svgLoad = svgPlugin.load
if (!svgLoad) throw new Error('vite-plugin-svgr must provide a load hook')
// SVGR's internal include filter still crosses the JS bridge for every module.
svgPlugin.load = {
  filter: { id: /\.svg\?react$/ },
  handler: typeof svgLoad === 'function' ? svgLoad : svgLoad.handler,
}

export default defineConfig({
  root: 'src',
  server: { port: 3000 },
  plugins: [
    svgPlugin,
    react(),
    legacy({
      modernTargets: ['edge>=109', 'safari>=14'],
      renderLegacyChunks: false,
      // Auto-detected from the emitted bundle, dependencies included,
      // so post-Safari-14 APIs never depend on extending a manual list.
      modernPolyfills: true,
      additionalModernPolyfills: [
        path.resolve('./src/polyfills/matchMedia.js'),
        path.resolve('./src/polyfills/WeakRef.js'),
        path.resolve('./src/polyfills/RegExp.js'),
      ],
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      '@root': path.resolve('.'),
      'monaco-editor/esm/vs/editor/editor.worker.js':
        'monaco-editor/editor/editor.worker',
    },
  },
  define: {
    OS_PLATFORM: `"${process.platform}"`,
  },
})
