export const getDnsLeakStatus = (
  exitCountry: string,
  resolverCountries: string[],
): 'unknown' | 'safe' | 'mismatch' => {
  const exit = exitCountry.trim().toUpperCase()
  const countries = resolverCountries.map((country) =>
    country.trim().toUpperCase(),
  )
  if (!exit || !countries.length || countries.some((country) => !country))
    return 'unknown'
  return countries.every((country) => country === exit) ? 'safe' : 'mismatch'
}

export const getWebrtcLeakState = (
  addresses: string[],
  egressIps: string[],
) => {
  if (!egressIps.length) return { state: 'unknown' as const, leaked: [] }
  if (!addresses.length) return { state: 'blocked' as const, leaked: [] }
  const leaked = addresses.filter((ip) => !egressIps.includes(ip))
  return {
    state: leaked.length ? ('leak' as const) : ('safe' as const),
    leaked,
  }
}
