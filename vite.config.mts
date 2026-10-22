import path from 'node:path'

import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

export default defineConfig({
  root: 'src',
  server: { port: 3000 },
  plugins: [
    svgr(),
    react(),
    legacy({
      modernTargets: ['edge>=109', 'safari>=14'],
      renderLegacyChunks: false,
      modernPolyfills: ['es.object.has-own', 'web.structured-clone'],
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
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // 重型依赖按职责拆分独立 chunk：
          // - monaco-editor 仅被 profiles 页（动态 import）使用，独立后不进首屏
          // - MUI/Emotion 与 React 运行时拆开，提升浏览器并行解析与缓存命中率
          // - i18next 系列独立 chunk
          if (id.includes('node_modules')) {
            if (id.includes('monaco-editor')) return 'monaco'
            if (id.includes('@mui') || id.includes('@emotion')) return 'mui'
            if (
              id.includes('react-router') ||
              id.includes('react-dom') ||
              id.includes('/react/') ||
              id.includes('scheduler')
            )
              return 'react-vendor'
            if (id.includes('i18next')) return 'i18n'
          }
        },
      },
    },
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
