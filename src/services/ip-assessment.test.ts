import { fetch } from '@tauri-apps/plugin-http'
import { beforeEach, expect, test, vi } from 'vitest'

import {
  getIpAssessment,
  groupAssessmentValues,
  isHttpsAssessmentUrl,
  type IpAssessmentProvider,
} from './ip-assessment'

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('./api', () => ({
  getIpInfo: vi.fn(async () => ({ ip: '203.0.113.10' })),
}))

const ipapi = (key: string): IpAssessmentProvider[] => [
  { type: 'ipapi', url: 'https://api.ipapi.is/', key },
]

const request = vi.mocked(fetch)
const publicResult = {
  ip: '203.0.113.8',
  asn: 64500,
  asOrganization: 'Example ISP',
  country: 'United States',
  countryCode: 'US',
  city: 'Seattle',
  fraudScore: 0,
  isResidential: true,
  isBroadcast: false,
}

beforeEach(() => request.mockReset())

test('uses public detection without a key and keeps missing flags unknown', async () => {
  request.mockResolvedValueOnce(Response.json(publicResult))
  const [result] = await getIpAssessment([])
  expect(result).toMatchObject({
    provider: 'IPPure',
    ip: '203.0.113.8',
    riskScore: 0,
    networkType: 'residential',
    broadcast: false,
    flags: {
      proxy: null,
      vpn: null,
      tor: null,
      datacenter: false,
      abuser: null,
    },
  })
  expect(request.mock.calls[0][0]).toBe('https://my.ippure.com/v1/info')
})

test('uses the key only in a POST body and preserves keyed flags without inventing a score', async () => {
  request.mockResolvedValueOnce(
    Response.json({
      ip: '203.0.113.9',
      company: { name: 'Example Host', type: 'hosting' },
      asn: { asn: 64501, org: 'Example Host' },
      location: { country_code: 'US' },
      is_proxy: false,
      is_vpn: true,
      is_tor: false,
      is_datacenter: true,
      is_abuser: false,
    }),
  )
  const [result] = await getIpAssessment(ipapi('secret-key'))
  expect(result).toMatchObject({
    provider: 'ipapi.is',
    riskScore: null,
    flags: { vpn: true, proxy: false },
  })
  expect(request.mock.calls[0][0]).toBe('https://api.ipapi.is/')
  expect(request.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    body: '{"q":"203.0.113.10","key":"secret-key"}',
    maxRedirections: 0,
  })
})

test.each([
  Response.json({ error: 'Invalid key' }),
  new Response('', { status: 429 }),
])(
  'falls back to public detection after a keyed rejection',
  async (response) => {
    request
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(Response.json(publicResult))
    expect((await getIpAssessment(ipapi('bad-key')))[0]).toMatchObject({
      provider: 'IPPure',
      fallback: true,
    })
    expect(request).toHaveBeenCalledTimes(2)
  },
)

test('rejects malformed addresses and never treats an invalid risk score as clean', async () => {
  request.mockResolvedValueOnce(
    Response.json({ ...publicResult, fraudScore: -1 }),
  )
  expect((await getIpAssessment([]))[0].riskScore).toBeNull()
  request.mockResolvedValueOnce(
    Response.json({ ip: 'not-an-ip', fraudScore: 0 }),
  )
  await expect(getIpAssessment([])).rejects.toThrow('IP assessment unavailable')
})

test('recognizes documented non-boolean VPN detections', async () => {
  request.mockResolvedValueOnce(
    Response.json({ ip: '203.0.113.9', is_vpn: 'NordVPN' }),
  )
  expect((await getIpAssessment(ipapi('key')))[0].flags.vpn).toBe(true)
})

test('works on WebViews without AbortSignal.timeout', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!
  Reflect.deleteProperty(AbortSignal, 'timeout')
  try {
    request.mockResolvedValueOnce(Response.json(publicResult))
    expect((await getIpAssessment([]))[0].riskScore).toBe(0)
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', descriptor)
  }
})

test('maps cleanip.io risk records, sends the key only as a header and leaves unreported items empty', async () => {
  request.mockResolvedValueOnce(
    Response.json({
      ok: true,
      ip: '203.0.113.10',
      geo: { country_code: 'US', country_en: 'United States' },
      network: { asn: 64502, isp: 'Example ISP' },
      purity: { ip_type: 'Residential' },
      risk: {
        is_proxy: false,
        is_vpn: true,
        dnsbl_count: 2,
        abuse_reports: 0,
        abuse_report_window_days: 90,
        proxycheck_risk: 8,
        proxycheck_device_address_count: 3,
        network_abuser: { score: 0.002 },
        risk_score: 12,
      },
    }),
  )
  const [result] = await getIpAssessment([
    { type: 'cleanip', url: 'https://api.cleanip.io/', key: 'cip_test' },
  ])
  expect(result).toMatchObject({
    provider: 'cleanip.io',
    networkType: 'residential',
    riskScore: 12,
    checks: { proxy: false, vpn: true, dnsbl: true, reports: false, tor: null },
    metrics: {
      proxyRisk: 8,
      sharedDevices: 3,
      networkAbuse: 0.002,
      dnsbl: 2,
      reports: 0,
      reportDays: 90,
      publicLists: null,
    },
  })
  expect(request.mock.calls[0][0]).toBe(
    'https://api.cleanip.io/api/v2/203.0.113.10',
  )
  expect(request.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    headers: { 'X-API-Key': 'cip_test' },
    maxRedirections: 0,
  })
})

test.each(['ipapi', 'cleanip', 'ipinfo'] as const)(
  'never sends a %s key to an HTTP provider',
  async (type) => {
    request.mockResolvedValueOnce(Response.json(publicResult))
    const [result] = await getIpAssessment([
      { type, url: 'http://example.invalid', key: 'secret-key' },
    ])
    expect(result).toMatchObject({ provider: 'IPPure', fallback: true })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('https://my.ippure.com/v1/info')
  },
)

test('maps IPinfo lookup flags and authenticates only with a bearer header', async () => {
  request.mockResolvedValueOnce(
    Response.json({
      ip: '203.0.113.10',
      geo: { country: 'United States', country_code: 'US', city: 'Seattle' },
      as: { asn: 'AS64500', name: 'Example ISP', type: 'isp' },
      anonymous: {
        is_proxy: false,
        is_vpn: true,
        is_tor: false,
        is_relay: false,
        is_res_proxy: true,
      },
      is_anonymous: true,
      is_hosting: false,
      is_mobile: false,
    }),
  )
  const [result] = await getIpAssessment([
    { type: 'ipinfo', url: '', key: 'ipinfo-token' },
  ])
  expect(result).toMatchObject({
    provider: 'IPinfo',
    organization: 'Example ISP',
    asn: 'AS64500',
    countryCode: 'US',
    location: 'United States · Seattle',
    networkType: 'isp',
    riskScore: null,
    broadcast: null,
    flags: {
      proxy: false,
      vpn: true,
      tor: false,
      datacenter: false,
      abuser: null,
    },
    checks: {
      anonymous: true,
      residentialProxy: true,
      relay: false,
      dnsbl: null,
    },
    metrics: { proxyRisk: null, sharedDevices: null },
  })
  expect(request.mock.calls[0][0]).toBe(
    'https://api.ipinfo.io/lookup/203.0.113.10',
  )
  expect(request.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    headers: { Authorization: 'Bearer ipinfo-token' },
    maxRedirections: 0,
  })
})

test('keeps IPinfo Core missing individual anonymity flags unknown', async () => {
  request.mockResolvedValueOnce(
    Response.json({ ip: '203.0.113.10', is_anonymous: true, is_hosting: true }),
  )
  const [result] = await getIpAssessment([
    { type: 'ipinfo', url: '', key: 'core-token' },
  ])
  expect(result).toMatchObject({
    networkType: 'hosting',
    flags: { proxy: null, vpn: null, tor: null, datacenter: true },
    checks: { anonymous: true, residentialProxy: null },
  })
})

test.each(['', 'https://api.ipinfo.io/lite/', 'https://api.ipinfo.io/lookup/'])(
  'reads IPinfo Lite with unknown risk fields when using endpoint %s',
  async (url) => {
    if (!url.includes('/lite'))
      request.mockResolvedValueOnce(new Response('', { status: 403 }))
    request.mockResolvedValueOnce(
      Response.json({
        ip: '203.0.113.10',
        asn: 'AS64500',
        as_name: 'Example ISP',
        country_code: 'US',
        country: 'United States',
      }),
    )
    const [result] = await getIpAssessment([
      { type: 'ipinfo', url, key: 'lite-token' },
    ])
    expect(result).toMatchObject({
      provider: 'IPinfo',
      asn: 'AS64500',
      organization: 'Example ISP',
      countryCode: 'US',
      location: 'United States',
      riskScore: null,
      networkType: 'unknown',
      flags: { proxy: null, vpn: null, datacenter: null },
      checks: { anonymous: null },
    })
    expect(request.mock.calls.at(-1)![0]).toBe(
      'https://api.ipinfo.io/lite/203.0.113.10',
    )
    expect(request).toHaveBeenCalledTimes(url.includes('/lite') ? 1 : 2)
  },
)

test('falls back after an IPinfo authentication failure without treating it as a Lite-only token', async () => {
  request
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(Response.json(publicResult))
  const [result] = await getIpAssessment([
    { type: 'ipinfo', url: '', key: 'invalid-token' },
  ])
  expect(result).toMatchObject({ provider: 'IPPure', fallback: true })
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[1][0]).toBe('https://my.ippure.com/v1/info')
})

test('uses only IPPure when every configured service is disabled', async () => {
  request.mockResolvedValueOnce(Response.json(publicResult))
  const [result] = await getIpAssessment([
    { type: 'ipinfo', url: '', key: 'token', enabled: false },
    { type: 'ipapi', url: '', key: 'key', enabled: false },
    { type: 'cleanip', url: '', key: 'key', enabled: false },
  ])
  expect(result).toMatchObject({ provider: 'IPPure', fallback: false })
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe('https://my.ippure.com/v1/info')
})

test('skips a disabled service while querying multiple enabled services and retaining legacy defaults', async () => {
  request.mockImplementation(async (url) =>
    Response.json(
      String(url).includes('ipinfo')
        ? { ip: '203.0.113.10', is_hosting: true }
        : { ip: '203.0.113.10', is_vpn: true },
    ),
  )
  const results = await getIpAssessment([
    { type: 'cleanip', url: '', key: 'disabled-key', enabled: false },
    { type: 'ipinfo', url: '', key: 'token', enabled: true },
    ...ipapi('legacy-key'),
  ])
  expect(results.map(({ provider }) => provider)).toEqual([
    'IPinfo',
    'ipapi.is',
  ])
  expect(request).toHaveBeenCalledTimes(2)
})

test('recognizes the Residential IP label returned by the live CleanIP API', async () => {
  request.mockResolvedValueOnce(
    Response.json({
      ip: '203.0.113.10',
      purity: { ip_type: 'Residential IP' },
      network: { native_or_broadcast: 'native' },
    }),
  )
  const [result] = await getIpAssessment([
    { type: 'cleanip', url: '', key: 'key' },
  ])
  expect(result).toMatchObject({ networkType: 'residential', broadcast: false })
})

test.each(['isp', 'education', 'government', 'banking'])(
  'preserves documented company type %s instead of showing unknown',
  async (type) => {
    request.mockResolvedValueOnce(
      Response.json({ ip: '203.0.113.10', company: { type } }),
    )
    const [result] = await getIpAssessment(ipapi('key'))
    expect(result.networkType).toBe(type)
  },
)

test('accepts HTTPS or the default address and rejects unsafe or malformed addresses', () => {
  expect(isHttpsAssessmentUrl('')).toBe(true)
  expect(isHttpsAssessmentUrl(' https://api.example.com/custom ')).toBe(true)
  for (const url of [
    'http://example.com',
    'not a URL',
    '//example.com',
    'file:///tmp/key',
  ]) {
    expect(isHttpsAssessmentUrl(url)).toBe(false)
  }
})

test('retains successful results when another provider is rejected', async () => {
  request
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'quota' }))
    .mockResolvedValueOnce(
      Response.json({ ip: '203.0.113.9', is_vpn: false, is_crawler: true }),
    )
  const [result] = await getIpAssessment([
    { type: 'cleanip', url: '', key: 'cip_test' },
    ...ipapi('key'),
  ])
  expect(result).toMatchObject({
    provider: 'ipapi.is',
    fallback: false,
    checks: { crawler: true, dnsbl: null },
  })
})

test('queries every provider for the same IP and preserves conflicting and complementary results', async () => {
  request.mockImplementation(async (url) =>
    Response.json(
      String(url).includes('cleanip.io')
        ? {
            ip: '203.0.113.10',
            risk: {
              is_proxy: false,
              is_vpn: true,
              dnsbl_count: 0,
              risk_score: 9,
            },
          }
        : { ip: '203.0.113.10', is_proxy: false, is_vpn: false },
    ),
  )
  const results = await getIpAssessment([
    { type: 'cleanip', url: '', key: 'cip_test' },
    ...ipapi('key'),
  ])
  expect(results.map((result) => result.provider)).toEqual([
    'cleanip.io',
    'ipapi.is',
  ])
  expect(groupAssessmentValues(results, (result) => result.flags.vpn)).toEqual([
    { value: true, sources: [results[0]] },
    { value: false, sources: [results[1]] },
  ])
  expect(
    groupAssessmentValues(results, (result) => result.flags.proxy),
  ).toEqual([{ value: false, sources: results }])
  expect(
    groupAssessmentValues(results, (result) => result.metrics.dnsbl),
  ).toEqual([{ value: 0, sources: [results[0]] }])
  expect(groupAssessmentValues(results, (result) => result.riskScore)).toEqual([
    { value: 9, sources: [results[0]] },
  ])
  expect(groupAssessmentValues(results, (result) => result.flags.tor)).toEqual([
    { value: null, sources: results },
  ])
  expect(request.mock.calls[0][0]).toBe(
    'https://api.cleanip.io/api/v2/203.0.113.10',
  )
  expect(JSON.parse(request.mock.calls[1][1]!.body as string).q).toBe(
    '203.0.113.10',
  )
})

test('uses configured ipapi.is anonymously without sending an empty key', async () => {
  request.mockResolvedValueOnce(
    Response.json({
      ip: '203.0.113.10',
      company: 'Example ISP',
      asn: 'AS64500 Example ISP',
      country: 'United States',
      city: 'Seattle',
    }),
  )
  const [result] = await getIpAssessment(ipapi(''))
  expect(result).toMatchObject({
    provider: 'ipapi.is',
    organization: 'Example ISP',
    asn: 'AS64500',
    location: 'United States · Seattle',
    riskScore: null,
    flags: { vpn: null },
  })
  expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toEqual({
    q: '203.0.113.10',
  })
})

test.each([
  [429, '60', 61_000],
  [403, '60', 61_000],
  [429, 'Wed, 28 Oct 2026 12:02:00 GMT', 121_000],
  [429, null, 43_200_001],
  [403, null, 86_400_001],
] as const)(
  'pauses anonymous queries after status %s and Retry-After %s',
  async (status, retryAfter, wait) => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-28T12:00:00Z'))
      const providers: IpAssessmentProvider[] = [
        {
          type: 'ipapi',
          url: `https://api.example.test/limit-${status}-${retryAfter?.length ?? 0}`,
          key: '',
        },
      ]
      request
        .mockResolvedValueOnce(
          new Response('', {
            status,
            headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
          }),
        )
        .mockResolvedValueOnce(Response.json(publicResult))
        .mockResolvedValueOnce(Response.json(publicResult))
        .mockResolvedValueOnce(
          Response.json({ ip: '203.0.113.10', is_vpn: false }),
        )
      expect((await getIpAssessment(providers))[0].provider).toBe('IPPure')
      vi.advanceTimersByTime(wait - 1_001)
      expect((await getIpAssessment(providers))[0].provider).toBe('IPPure')
      vi.advanceTimersByTime(1_001)
      expect((await getIpAssessment(providers))[0].provider).toBe('ipapi.is')
      expect(request).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  },
)
