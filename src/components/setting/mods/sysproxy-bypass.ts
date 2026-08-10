export const splitBypass = (value?: string) =>
  (value ?? '')
    .split(/[,\n;\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const uniqueBypass = (items: string[]) => [...new Set(items)]

export const normalizeBypass = (value: string | undefined, separator: string) =>
  uniqueBypass(splitBypass(value)).join(separator)

export const materializeBypass = (
  value: string | undefined,
  defaults: string[],
  separator: string,
  includeDefaults: boolean,
) =>
  uniqueBypass([
    ...(includeDefaults ? defaults : []),
    ...splitBypass(value),
  ]).join(separator)
