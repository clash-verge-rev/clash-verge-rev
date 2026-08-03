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
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    // Node by default because most tests are pure functions; render tests opt in per file
    // with `// @vitest-environment jsdom`, so the DOM cost is paid only where it buys
    // something.
    environment: 'node',
    restoreMocks: true,
  },
})
