import path from 'node:path'

import { defineConfig } from 'vitest/config'

// Separate from vite.config.mts because that one sets `root: 'src'` for the app build,
// while tests live alongside the code they cover *and* under tests/.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve('./src'),
      '@root': path.resolve('.'),
    },
  },
  define: {
    OS_PLATFORM: `"${process.platform}"`,
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
})
