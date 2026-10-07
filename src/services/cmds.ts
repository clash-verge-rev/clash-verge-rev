import { Channel } from '@tauri-apps/api/core'
import dayjs from 'dayjs'

import { showNotice } from '@/services/notice-service'
import { debugLog } from '@/utils/debug'

import { commands } from './bindings'
import type {
  DownloadEvent,
  JsonValue,
  ListenerProbe,
  ProxyPortSettings,
  UnlockItem,
  ProxyViewV1_Serialize as ProxyViewV1,
  ProfileSelection,
  ProfilePatch,
  ProfileCreate,
} from './bindings'

export type {
  RunningMode,
  RunStateView as RunState,
  FailedOperation,
  PendingFailure,
  SidecarFailureSnapshot,
  ServiceInstallOutcome,
  ProxyPortSettings,
  ListenerTransport,
  ListenerProbe,
  UnlockItem,
} from './bindings'

export async function copyClashEnv() {
  return commands.copyClashEnv()
}

export async function getProfiles(): Promise<IProfilesConfig> {
  return commands.getProfiles()
}

export async function enhanceProfiles() {
  return (await commands.enhanceProfiles()).status === 'valid'
}

export async function patchProfilesConfig(profiles: ProfileSelection) {
  return commands.patchProfilesConfig({ current: profiles.current })
}

export async function createProfile(
  item: ProfileCreate,
  fileData?: string | null,
) {
  return commands.createProfile(
    {
      type: item.type,
      name: item.name,
      desc: item.desc,
      ...(item.type === 'remote' ? { url: item.url } : {}),
      option: item.option,
    },
    fileData ?? null,
  )
}

export async function viewProfile(index: string) {
  return commands.viewProfile(index)
}

export async function readProfileFile(index: string) {
  return commands.readProfileFile(index)
}

export async function saveProfileFile(index: string, fileData: string) {
  return (await commands.saveProfileFile(index, fileData)).status === 'valid'
}

export async function importProfile(url: string, option?: IProfileOption) {
  return commands.importProfile(url, option || { with_proxy: true })
}

export async function reorderProfile(activeId: string, overId: string) {
  return commands.reorderProfile(activeId, overId)
}

export async function updateProfile(index: string, option?: IProfileOption) {
  return commands.updateProfile(index, option ?? null)
}

export async function deleteProfile(index: string) {
  return commands.deleteProfile(index)
}

export async function patchProfile(index: string, profile: ProfilePatch) {
  const { type, name, desc, file, url, selected, extra, updated, option } =
    profile
  return commands.patchProfile(index, {
    type,
    name,
    desc,
    file,
    url,
    selected,
    extra,
    updated,
    option,
  })
}

export async function getClashInfo() {
  return commands.getClashInfo()
}

// Fallback mode read independent of strict mihomo `/configs` deserialization.
export async function getClashMode() {
  return commands.getClashMode()
}

export async function getRuntimeConfig() {
  return (await commands.getRuntimeConfig()) as IConfigData | null
}

export async function getRuntimeYaml() {
  return commands.getRuntimeYaml()
}

export async function getRuntimeLogs() {
  return commands.getRuntimeLogs()
}

export async function getRuntimeProxyChainConfig(proxyChainExitNode: string) {
  return commands.getRuntimeProxyChainConfig(proxyChainExitNode)
}

export async function updateProxyChainConfigInRuntime(
  proxyChainConfig: unknown,
) {
  const outcome = await commands.updateProxyChainConfigInRuntime(
    proxyChainConfig == null ? null : (proxyChainConfig as JsonValue),
  )
  if (outcome.status === 'invalid') throw new Error(outcome.message)
  if (outcome.status === 'skipped') {
    throw new Error(`Proxy chain validation skipped: ${outcome.reason}`)
  }
  return outcome
}

export async function patchClashConfig(payload: Partial<IConfigData>) {
  return commands.patchClashConfig(payload as Record<string, JsonValue>)
}

export async function patchClashMode(payload: string) {
  return commands.patchClashMode(payload)
}

export async function syncTrayProxySelection() {
  return commands.syncTrayProxySelection()
}

/** Sends one selection pair so the backend can merge against current profile state. */
export async function recordSelectedNode(groupName: string, node: string) {
  return commands.recordSelectedNode(groupName, node)
}

export async function forgetSelectedNode(groupName: string) {
  return commands.forgetSelectedNode(groupName)
}

export async function getProxyView(): Promise<ProxyViewV1> {
  const view = await commands.getProxyView()
  if (view.schemaVersion !== 1) {
    throw new Error('Unsupported proxy view schema: ' + view.schemaVersion)
  }
  return view
}

export async function getClashLogs() {
  const regex = /time="(.+?)"\s+level=(.+?)\s+msg="(.+?)"/
  const newRegex = /(.+?)\s+(.+?)\s+(.+)/
  const logs = await commands.getClashLogs()

  return logs.reduce<ILogItem[]>((acc, log) => {
    const result = log.match(regex)
    if (result) {
      const [_, _time, type, payload] = result
      const time = dayjs(_time).format('MM-DD HH:mm:ss')
      acc.push({ time, type, payload })
      return acc
    }

    const result2 = log.match(newRegex)
    if (result2) {
      const [_, time, type, payload] = result2
      acc.push({ time, type, payload })
    }
    return acc
  }, [])
}

export async function getVergeConfig(): Promise<IVergeConfig> {
  return commands.getVergeConfig()
}

export async function patchVergeConfig(payload: IVergeConfig) {
  return commands.patchVergeConfig(payload)
}

export async function setDnsOverride(
  profileUid: string,
  enabled: boolean,
  confirmation?: string,
) {
  return commands.setDnsOverride(profileUid, enabled, confirmation ?? null)
}

export async function getDnsConfigContent() {
  return commands.getDnsConfigContent()
}

export async function saveDnsConfig(dnsConfig: Record<string, unknown>) {
  return commands.saveDnsConfig(dnsConfig as Record<string, JsonValue>)
}

export async function validateDnsConfig() {
  return commands.validateDnsConfig()
}

export async function applyDnsConfig(apply: boolean) {
  return commands.applyDnsConfig(apply)
}

export async function takeDnsOverrideNotice() {
  return commands.takeDnsOverrideNotice()
}

export async function takeServiceFallbackNotice() {
  return commands.takeServiceFallbackNotice()
}

export async function getCoreStartupError() {
  return commands.getCoreStartupError()
}

export async function takeServiceRepairNotice() {
  return commands.takeServiceRepairNotice()
}

export async function takeServiceOwnerNotice() {
  return commands.takeServiceOwnerNotice()
}

export async function takeDiscardedKeysNotice() {
  return commands.takeDiscardedKeysNotice()
}

export async function getSystemProxy() {
  return commands.getSysProxy()
}

export async function getAutotemProxy() {
  try {
    debugLog('[API] 开始调用 get_auto_proxy')
    const result = await commands.getAutoProxy()
    debugLog('[API] get_auto_proxy 调用成功:', result)
    return result
  } catch (error) {
    console.error('[API] get_auto_proxy 调用失败:', error)
    return {
      enable: false,
      url: '',
    }
  }
}

export async function getEmbeddedServerPort() {
  return commands.getEmbeddedServerPort()
}

export async function changeClashCore(clashCore: string) {
  return commands.changeClashCore(clashCore)
}

export async function restartCore() {
  return commands.restartCore()
}

export async function upgradeClashCore(force = false) {
  return commands.upgradeClashCore(force)
}

export async function restartApp() {
  return commands.restartApp()
}

export async function installUpdate(
  version: string,
  onEvent: (event: DownloadEvent) => void,
) {
  const channel = new Channel<DownloadEvent>()
  channel.onmessage = onEvent
  return commands.installUpdate(version, channel)
}

export async function cancelUpdateDownload() {
  return commands.cancelUpdateDownload()
}

export async function getAppDir() {
  return commands.getAppDir()
}

export async function openAppDir() {
  return commands.openAppDir().catch((err) => showNotice.error(err))
}

export async function openCoreDir() {
  return commands.openCoreDir().catch((err) => showNotice.error(err))
}

export async function openLogsDir() {
  return commands.openLogsDir().catch((err) => showNotice.error(err))
}

export async function syncRuntimeProviders() {
  return commands.syncRuntimeProviders().catch((err) => {
    console.warn('failed to queue the provider cache sync', err)
  })
}

export async function cmdTestDelay(url: string) {
  return commands.testDelay(url)
}

export async function invoke_uwp_tool() {
  return commands.invokeUwpTool().catch((err) => showNotice.error(err, 1500))
}

export async function openDevTools() {
  return commands.openDevtools()
}

export async function exitApp() {
  return commands.exitApp()
}

export async function exportDiagnosticInfo() {
  return commands.exportDiagnosticInfo()
}

export async function getSystemInfo() {
  return commands.getSystemInfo()
}

export async function copyIconFile(
  path: string,
  name: 'common' | 'sysproxy' | 'tun',
) {
  const key = `icon_${name}_update_time`
  const previousTime = localStorage.getItem(key) || ''

  const currentTime = String(Date.now())
  localStorage.setItem(key, currentTime)

  const iconInfo = {
    name,
    previous_t: previousTime,
    current_t: currentTime,
  }

  return commands.copyIconFile(path, iconInfo)
}

export async function downloadIconCache(url: string, name: string) {
  return commands.downloadIconCache(url, name)
}

export async function getNetworkInterfaces() {
  return commands.getNetworkInterfaces()
}

export async function getSystemHostname() {
  return commands.getSystemHostname()
}

export async function getNetworkInterfacesInfo() {
  return commands.getNetworkInterfacesInfo()
}

export async function createWebdavBackup() {
  return commands.createWebdavBackup()
}

export async function createLocalBackup() {
  return commands.createLocalBackup()
}

export async function deleteWebdavBackup(filename: string) {
  return commands.deleteWebdavBackup(filename)
}

export async function deleteLocalBackup(filename: string) {
  return commands.deleteLocalBackup(filename)
}

export async function restoreWebDavBackup(filename: string) {
  return commands.restoreWebdavBackup(filename)
}

export async function restoreLocalBackup(filename: string) {
  return commands.restoreLocalBackup(filename)
}

export async function importLocalBackup(source: string) {
  return commands.importLocalBackup(source)
}

export async function exportLocalBackup(filename: string, destination: string) {
  return commands.exportLocalBackup(filename, destination)
}

export async function saveWebdavConfig(
  url: string,
  username: string,
  password: string,
) {
  return commands.saveWebdavConfig(url, username, password)
}

export async function listWebDavBackup() {
  return (await commands.listWebdavBackup()).map((item) => ({
    ...item,
    filename: item.href.split('/').pop() ?? '',
  }))
}

export async function listLocalBackup() {
  return commands.listLocalBackup()
}

/** Consistent core/service snapshot with backend-derived availability flags. */

export const getRuntimeState = async () => {
  return commands.getRuntimeState()
}

export const getPendingFailures = async () => {
  return commands.getPendingFailures()
}

export const getSidecarFailure = async () => {
  return commands.getSidecarFailure()
}

export const getAppUptime = async () => {
  return commands.getAppUptime()
}

export const installService = async () => {
  return commands.installService()
}

export const uninstallService = async () => {
  return commands.uninstallService()
}

export const reinstallService = async () => {
  return commands.reinstallService()
}

export const repairService = async () => {
  return commands.repairService()
}

export const continueWithSidecar = async () => {
  return commands.continueWithSidecar()
}

export const entry_lightweight_mode = async () => {
  return commands.entryLightweightMode()
}

export async function getNextUpdateTime(uid: string) {
  return commands.getNextUpdateTime(uid)
}

export const probeListener = async (request: ListenerProbe) => {
  return commands.probeListener(request)
}

export const saveProxyPorts = async (settings: ProxyPortSettings) => {
  return commands.saveProxyPorts(settings)
}

export async function getUnlockItems() {
  return commands.getUnlockItems()
}

export async function checkMediaUnlock(onComplete: Channel<UnlockItem>) {
  return commands.checkMediaUnlock(onComplete)
}

export async function checkMediaUnlockItem(name: string) {
  return commands.checkMediaUnlockItem(name)
}
