// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/**
 * Stub the Tauri boundary and nothing above it.
 *
 * Everything the provider mounts — SWR queries, the config hooks, the event subscription,
 * the mihomo plugin — goes through `invoke` or `listen`, so replacing just those two leaves
 * all the real application code running. A test that stubbed the hooks instead could not
 * catch what this one exists to catch.
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class {},
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  TauriEvent: {},
}))

import { AppDataProvider } from './app-data-provider'

beforeEach(() => {
  // The provider's queries poll; keep them from firing during the assertion.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Mounting the provider is the whole test.
 *
 * A hook inside `AppDataProvider` that reads a context `AppDataProvider` itself supplies
 * throws during render and blanks the entire UI. That shipped once. `typecheck`, `lint`,
 * `knip` and `web:build` all passed with it present, and so did an independent review —
 * nothing but rendering can see it.
 */
test('AppDataProvider mounts and renders its children', () => {
  render(
    <AppDataProvider>
      <span>child rendered</span>
    </AppDataProvider>,
  )

  expect(screen.getByText('child rendered')).toBeDefined()
})

test('AppDataProvider does not consume a context it provides', () => {
  // The failure mode is specific enough to name: `useCtx` throws
  // "<hook> must be used within AppDataProvider" when a provider reads its own context,
  // which is indistinguishable at the type level from a legitimate call site.
  const errors: unknown[] = []
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args) => {
      errors.push(args)
    })

  expect(() =>
    render(
      <AppDataProvider>
        <span>child rendered</span>
      </AppDataProvider>,
    ),
  ).not.toThrow()

  const reported = errors.flat().join(' ')
  expect(reported).not.toContain('must be used within AppDataProvider')

  consoleError.mockRestore()
})
