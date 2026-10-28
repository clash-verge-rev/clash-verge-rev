import { useLocalStorage } from 'foxact/use-local-storage'

import {
  getIpAssessment,
  IP_ASSESSMENT_PROVIDER_URLS,
  type IpAssessmentProvider,
} from '@/services/ip-assessment'
import { useQuery } from '@/services/query-client'

const PROVIDERS_KEY = 'ip-assessment-providers'
const LEGACY_KEY = 'ip-assessment-api-key'

// Carries a key saved by the single-key setting into the provider list.
const DEFAULT_PROVIDERS = ((): IpAssessmentProvider[] => {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '""')
    return typeof legacy === 'string' && legacy.trim()
      ? [{ type: 'ipapi', url: IP_ASSESSMENT_PROVIDER_URLS.ipapi, key: legacy }]
      : []
  } catch {
    return []
  }
})()

export const useIpAssessmentProviders = () =>
  useLocalStorage<IpAssessmentProvider[]>(PROVIDERS_KEY, DEFAULT_PROVIDERS)

export const useIpAssessment = () => {
  const [providers] = useIpAssessmentProviders()
  return useQuery({
    queryKey: ['ipAssessment', providers],
    queryFn: () => getIpAssessment(providers),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
}
