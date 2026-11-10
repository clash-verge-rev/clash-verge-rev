import type { ProxyViewV1 } from '@/types/proxy-view'

export interface TrayHealthGroupOption {
  name: string
  unavailable: boolean
}

export const normalizeTrayHealthGroup = (value: string | null | undefined) =>
  value || null

export function getTrayHealthGroupOptions(
  proxyView: ProxyViewV1 | undefined,
  selected: string | null | undefined,
): TrayHealthGroupOption[] {
  const selectedName = normalizeTrayHealthGroup(selected)
  const options: TrayHealthGroupOption[] = []
  const seen = new Set<string>()

  for (const group of proxyView?.groups ?? []) {
    if (seen.has(group.name)) continue
    if (group.hidden && group.name !== selectedName) continue
    seen.add(group.name)
    options.push({ name: group.name, unavailable: false })
  }

  // Without a loaded view (core stopped or still loading) availability is unknown,
  // so the saved group is kept without being flagged.
  if (selectedName && !seen.has(selectedName)) {
    options.push({ name: selectedName, unavailable: proxyView !== undefined })
  }

  return options
}
