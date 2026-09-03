import { useLockFn } from 'ahooks'
import i18n from 'i18next'
import { getVersion } from 'tauri-plugin-mihomo-api'

import {
  getDefaultClashConfig,
  getClashInfo,
  getClashMode,
  getRuntimeConfig,
  patchClashConfig,
} from '@/services/cmds'
import {
  getCacheData,
  revalidateQuery,
  setCacheData,
  useQuery,
} from '@/services/query-client'

type MutateClashUpdater =
  | ((old: IConfigData | undefined) => IConfigData | undefined)
  | IConfigData
  | undefined

const PORT_KEYS = [
  'port',
  'socks-port',
  'mixed-port',
  'redir-port',
  'tproxy-port',
] as const

type ClashInfoPatch = Partial<
  Pick<
    IConfigData,
    | 'port'
    | 'socks-port'
    | 'mixed-port'
    | 'redir-port'
    | 'tproxy-port'
    | 'external-controller'
    | 'secret'
  >
>

const hasClashInfoPayload = (patch: ClashInfoPatch) =>
  PORT_KEYS.some((key) => patch[key] != null) ||
  patch['external-controller'] != null ||
  patch.secret != null

const validatePortRange = (port: number) => {
  if (port < 1000) {
    throw new Error(
      i18n.t(($) => $.settings.modals.clashPort.messages.portTooLow),
    )
  }
  if (port > 65535) {
    throw new Error(
      i18n.t(($) => $.settings.modals.clashPort.messages.portTooHigh),
    )
  }
}

const validatePorts = (patch: ClashInfoPatch) => {
  PORT_KEYS.forEach((key) => {
    const port = patch[key]
    if (!port) return
    validatePortRange(port)
  })
}

export const useRuntimeConfig = (shouldFetch: boolean = true) => {
  return useQuery({
    queryKey: ['getRuntimeConfig'],
    queryFn: getRuntimeConfig,
    enabled: shouldFetch,
  })
}

// Fault-tolerant fallback for the current proxy mode, read straight from the
// saved clash config on the backend (bypasses the strict BaseConfig path).
export const useClashMode = (shouldFetch: boolean = true) => {
  return useQuery({
    queryKey: ['getClashMode'],
    queryFn: getClashMode,
    enabled: shouldFetch,
  })
}

export const useClash = () => {
  const { data: clash, refetch } = useRuntimeConfig()

  const { data: versionData, refetch: mutateVersion } = useQuery({
    queryKey: ['getVersion'],
    queryFn: getVersion,
  })

  const mutateClash = (updater?: MutateClashUpdater, revalidate?: boolean) => {
    if (updater === undefined) {
      return refetch()
    }
    const next =
      typeof updater === 'function'
        ? updater(getCacheData<IConfigData>(['getRuntimeConfig']))
        : updater
    setCacheData(['getRuntimeConfig'], next)
    if (revalidate !== false) {
      return refetch()
    }
    return Promise.resolve()
  }

  const patchClash = useLockFn(async (patch: Partial<IConfigData>) => {
    await patchClashConfig(patch)
    mutateClash()
  })

  const version = versionData?.meta
    ? `${versionData.version} Mihomo`
    : versionData?.version || '-'

  return {
    clash,
    version,
    mutateClash,
    mutateVersion,
    patchClash,
  }
}

export const useClashInfo = () => {
  const { data: clashInfo, refetch: mutateInfo } = useQuery({
    queryKey: ['getClashInfo'],
    queryFn: getClashInfo,
  })

  const patchInfo = useLockFn(async (patch: ClashInfoPatch) => {
    if (!hasClashInfoPayload(patch)) return

    validatePorts(patch)

    await patchClashConfig(patch)
    mutateInfo()
    revalidateQuery(['getClashConfig'])
  })

  const invalidateClashConfig = () => revalidateQuery(['getClashConfig'])

  return {
    clashInfo,
    mutateInfo,
    patchInfo,
    invalidateClashConfig,
  }
}

export const useClashConfigField = <T extends keyof IConfigData>(
  field: T,
  fallbackValue: NonNullable<IConfigData[T]>,
  isModified?: (
    value: IConfigData[T] | undefined,
    defaultValue: IConfigData[T] | undefined,
  ) => boolean,
): ConfigField<IConfigData[T]> => {
  const { clash, mutateClash, patchClash } = useClash()
  const { data: defaultClashConfig } = useQuery({
    queryKey: ['getDefaultClashConfig'],
    queryFn: getDefaultClashConfig,
  })

  return {
    value: clash?.[field] ?? fallbackValue,
    defaultValue: defaultClashConfig?.[field] ?? fallbackValue,
    modified: isModified
      ? isModified(clash?.[field], defaultClashConfig?.[field])
      : clash?.[field] !== defaultClashConfig?.[field],
    mutate: async function (newValue: IConfigData[T]): Promise<void> {
      await mutateClash(
        (prev) => (prev ? { ...prev, [field]: newValue } : prev),
        false,
      )
    },
    patch: async function (newValue: IConfigData[T]): Promise<void> {
      await patchClash({ [field]: newValue })
    },
    reset: async function (): Promise<void> {
      if (defaultClashConfig) {
        await patchClash({ [field]: defaultClashConfig[field] })
      }
    },
  }
}
