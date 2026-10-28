import type { IpAssessment } from '@/services/ip-assessment'

export const getIpRiskColor = (score: number | null) => {
  if (score === null) return 'default' as const
  if (score < 30) return 'success' as const
  return score < 70 ? ('warning' as const) : ('error' as const)
}

export const getNetworkTypeColor = (type: IpAssessment['networkType']) => {
  if (type === 'unknown') return 'default' as const
  return ['residential', 'mobile', 'isp'].includes(type)
    ? ('success' as const)
    : ('warning' as const)
}
