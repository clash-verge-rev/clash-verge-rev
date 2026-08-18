// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// Stub only the Tauri boundary so the real provider tree still renders.
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
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

// Rendering catches a provider reading its own context, which static checks cannot detect.
test('AppDataProvider mounts and renders its children', () => {
  render(
    <AppDataProvider>
      <span>child rendered</span>
    </AppDataProvider>,
  )

  expect(screen.getByText('child rendered')).toBeDefined()
})

test('AppDataProvider does not consume a context it provides', () => {
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
