import { Switch as MuiSwitch } from '@mui/material'

import { fixture } from './state'

const translations = {
  en: (key: string) => `en:${key}`,
  zh: (key: string) => `zh:${key}`,
}
export const useTranslation = () => ({
  t: translations[fixture.language as 'en' | 'zh'],
})
export const useVerge = () => ({ verge: fixture.verge })
export const useProfiles = () => ({ current: { uid: 'fixture' } })
export const useClash = () => ({
  mutateClash: () => {
    throw new Error('Unexpected mutateClash')
  },
})
export const useSystemState = () => ({ isTunModeAvailable: fixture.available })
export const useSystemProxyState = () => ({ indicator: fixture.indicator })
export const useThemeMode = () => fixture.theme
export const getDnsConfigContent = async () => {
  fixture.commands.push('getDnsConfigContent')
  return fixture.initialDns
}
export const saveDnsConfig = async (config: any) => {
  fixture.commands.push('saveDnsConfig')
  fixture.saved.push(structuredClone(config))
}
export const validateDnsConfig = async () => {
  fixture.commands.push('validateDnsConfig')
  return { status: 'valid' }
}
export const applyDnsConfig = () => {
  throw new Error('Unexpected applyDnsConfig')
}
export const mutate = (fn: () => unknown) => fn()
export const showNotice = {
  error: (...args: any[]) => fixture.notices.push({ error: args }),
  success: (...args: any[]) => fixture.notices.push({ success: args }),
}
export const Switch = MuiSwitch
export function BaseDialog({ open, title, children, onClose, onOk }: any) {
  return open ? (
    <section id="dns">
      {title}
      <button id="close-dns" onClick={onClose}>
        close
      </button>
      <button id="save-dns" onClick={onOk}>
        save
      </button>
      {children}
    </section>
  ) : null
}
export function MonacoEditor({ value, onChange }: any) {
  return (
    <textarea
      id="fixture-monaco"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
export default function ProxyControlSwitches({ label }: any) {
  return <output id="fixture-controls">{label}</output>
}
