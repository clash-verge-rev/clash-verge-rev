import { ipv4, ipv6 } from 'cidr-block'
import validator from 'validator'

const stripBrackets = (value: string) =>
  value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value

const isIpv4 = (value: string) => validator.isIP(value, 4)
const isIpv6 = (value: string) => validator.isIP(value, 6)
const isHostname = (value: string) =>
  validator.isFQDN(value, { require_tld: false })

export const isValidUrl = (value: string) =>
  validator.isURL(value.trim(), {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
    require_host: true,
    require_tld: false,
  })

export const isValidPort = (value: string) => validator.isPort(value.trim())

export const normalizeHost = (value: string): string | null => {
  const host = value.trim()
  if (!host) {
    return null
  }

  if (host.toLowerCase() === 'localhost') {
    return 'localhost'
  }

  const normalizedHost = stripBrackets(host)
  if (isIpv4(normalizedHost) || isIpv6(normalizedHost)) {
    return normalizedHost
  }

  return isHostname(host) ? host : null
}

export const normalizeListenHost = (value: string): string | null => {
  const host = normalizeHost(value)
  if (!host || host === 'localhost') {
    return host
  }

  if (isIpv4(host)) {
    const address = ipv4.address(host)
    return address.equals('0.0.0.0') ||
      address.isLoopbackAddress() ||
      address.isPrivateAddress()
      ? host
      : null
  }

  if (!isIpv6(host)) {
    return null
  }

  const address = ipv6.address(host)
  return address.isUnspecifiedAddress() ||
    address.isLoopbackAddress() ||
    address.isUniqueLocalAddress() ||
    address.isLinkLocalAddress()
    ? host
    : null
}

export const formatHostPort = (host: string, port: string | number) =>
  isIpv6(host) ? `[${host}]:${port}` : `${host}:${port}`

export const isValidIpCidr = (value: string): boolean => {
  const cidr = value.trim()
  const slashIndex = cidr.lastIndexOf('/')
  if (slashIndex <= 0) {
    return false
  }

  const address = cidr.slice(0, slashIndex)
  return (
    (isIpv4(address) && ipv4.isValidCIDR(cidr)) ||
    (isIpv6(address) && ipv6.isValidCIDR(cidr))
  )
}

export const areValidIpCidrs = (values: string[]) => values.every(isValidIpCidr)
