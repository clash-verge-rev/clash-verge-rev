import AddRounded from '@mui/icons-material/AddRounded'
import SaveRounded from '@mui/icons-material/SaveRounded'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
  alpha,
  styled,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ManualProxyProtocol =
  | 'ss'
  | 'ssr'
  | 'socks5'
  | 'http'
  | 'trojan'
  | 'vmess'
  | 'vless'
  | 'hysteria2'
  | 'hysteria'
  | 'tuic'
  | 'wireguard'
  | 'anytls'

type AddPlacement = 'prepend' | 'append'

interface ManualProxyViewerProps {
  open: boolean
  existingNames: string[]
  proxyOptions?: string[]
  dialerProxyMap?: Record<string, string>
  mode?: 'add' | 'edit'
  initialProxy?: IProxyConfig | null
  onClose: () => void
  onAdd: (proxy: IProxyConfig, placement: AddPlacement) => void
  onSave?: (proxy: IProxyConfig) => void
}

interface ManualProxyForm {
  type: ManualProxyProtocol
  name: string
  server: string
  port: string
  username: string
  password: string
  cipher: CipherType
  uuid: string
  alterId: string
  network: NetworkType
  tls: boolean
  udp: boolean
  tfo: boolean
  skipCertVerify: boolean
  sni: string
  servername: string
  alpn: string
  fingerprint: string
  clientFingerprint: '' | ClientFingerprint
  flow: string
  wsPath: string
  wsHost: string
  grpcServiceName: string
  h2Path: string
  h2Host: string
  realityPublicKey: string
  realityShortId: string
  ssPlugin: '' | 'obfs' | 'v2ray-plugin'
  pluginMode: string
  pluginHost: string
  pluginPath: string
  ssrProtocol: string
  ssrObfs: string
  ssrProtocolParam: string
  ssrObfsParam: string
  auth: string
  obfs: string
  obfsPassword: string
  up: string
  down: string
  ports: string
  token: string
  congestionController: string
  ip: string
  ipv6: string
  privateKey: string
  publicKey: string
  preSharedKey: string
  dns: string
  mtu: string
  persistentKeepalive: string
  ipVersion: '' | NonNullable<IProxyBaseConfig['ip-version']>
  interfaceName: string
  dialerProxy: string
}

type FormErrors = Partial<Record<keyof ManualProxyForm, string>>

const TR_PREFIX = 'profiles.modals.manualProxy'
const EMPTY_PROXY_OPTIONS: string[] = []
const EMPTY_DIALER_PROXY_MAP: Record<string, string> = {}

const PROTOCOL_OPTIONS: { value: ManualProxyProtocol; label: string }[] = [
  { value: 'ss', label: 'Shadowsocks' },
  { value: 'ssr', label: 'ShadowsocksR' },
  { value: 'socks5', label: 'SOCKS5' },
  { value: 'http', label: 'HTTP / HTTPS' },
  { value: 'trojan', label: 'Trojan' },
  { value: 'vmess', label: 'VMess' },
  { value: 'vless', label: 'VLESS' },
  { value: 'hysteria2', label: 'Hysteria2' },
  { value: 'hysteria', label: 'Hysteria' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'wireguard', label: 'WireGuard' },
  { value: 'anytls', label: 'AnyTLS' },
]

const CIPHER_OPTIONS: CipherType[] = [
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'aes-128-cfb',
  'aes-256-cfb',
  'chacha20-ietf',
  'auto',
  'none',
]

const VMESS_CIPHER_OPTIONS: CipherType[] = [
  'auto',
  'none',
  'aes-128-gcm',
  'chacha20-ietf-poly1305',
]

const NETWORK_OPTIONS: NetworkType[] = ['tcp', 'ws', 'grpc', 'h2', 'http']

const CLIENT_FINGERPRINT_OPTIONS: ClientFingerprint[] = [
  'chrome',
  'firefox',
  'safari',
  'iOS',
  'android',
  'edge',
  'random',
]

const IP_VERSION_OPTIONS: NonNullable<IProxyBaseConfig['ip-version']>[] = [
  'dual',
  'ipv4',
  'ipv6',
  'ipv4-prefer',
  'ipv6-prefer',
]

const initialForm: ManualProxyForm = {
  type: 'ss',
  name: '',
  server: '',
  port: '',
  username: '',
  password: '',
  cipher: 'aes-128-gcm',
  uuid: '',
  alterId: '0',
  network: 'tcp',
  tls: false,
  udp: true,
  tfo: false,
  skipCertVerify: false,
  sni: '',
  servername: '',
  alpn: '',
  fingerprint: '',
  clientFingerprint: 'chrome',
  flow: '',
  wsPath: '',
  wsHost: '',
  grpcServiceName: '',
  h2Path: '',
  h2Host: '',
  realityPublicKey: '',
  realityShortId: '',
  ssPlugin: '',
  pluginMode: 'http',
  pluginHost: '',
  pluginPath: '',
  ssrProtocol: 'origin',
  ssrObfs: 'plain',
  ssrProtocolParam: '',
  ssrObfsParam: '',
  auth: '',
  obfs: '',
  obfsPassword: '',
  up: '',
  down: '',
  ports: '',
  token: '',
  congestionController: 'bbr',
  ip: '',
  ipv6: '',
  privateKey: '',
  publicKey: '',
  preSharedKey: '',
  dns: '',
  mtu: '',
  persistentKeepalive: '',
  ipVersion: '',
  interfaceName: '',
  dialerProxy: '',
}

const PROTOCOL_PORTS: Partial<Record<ManualProxyProtocol, string>> = {
  http: '8080',
  socks5: '1080',
  trojan: '443',
  vmess: '443',
  vless: '443',
  hysteria2: '443',
  hysteria: '443',
  tuic: '443',
  wireguard: '51820',
  anytls: '443',
}

const supportedProtocolSet = new Set(
  PROTOCOL_OPTIONS.map((option) => option.value),
)

const hasTransportOptions = (type: ManualProxyProtocol) =>
  type === 'trojan' || type === 'vmess' || type === 'vless'

const hasTlsOptions = (type: ManualProxyProtocol) =>
  [
    'http',
    'socks5',
    'trojan',
    'vmess',
    'vless',
    'hysteria2',
    'hysteria',
    'tuic',
    'anytls',
  ].includes(type)

const splitList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const toNumber = (value: string) => {
  if (!value.trim()) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

const cloneInitialForm = (): ManualProxyForm => ({ ...initialForm })

const toText = (value: unknown) => {
  if (value === undefined || value === null) return ''
  return String(value)
}

const toBoolean = (value: unknown) => value === true

const firstText = (value: unknown) => {
  if (Array.isArray(value)) return toText(value[0])
  return toText(value)
}

const joinTextList = (value: unknown) => {
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ')
  return toText(value)
}

const proxyTypeToProtocol = (value: unknown): ManualProxyProtocol => {
  const type = toText(value).toLowerCase()
  return supportedProtocolSet.has(type as ManualProxyProtocol)
    ? (type as ManualProxyProtocol)
    : 'ss'
}

const proxyToForm = (proxy: IProxyConfig | null | undefined) => {
  const form = cloneInitialForm()
  if (!proxy) return form

  const data = proxy as unknown as Record<string, any>
  const type = proxyTypeToProtocol(data.type)
  const pluginOpts = data['plugin-opts'] ?? {}
  const wsOpts = data['ws-opts'] ?? {}
  const wsHeaders = wsOpts.headers ?? data['ws-headers'] ?? {}
  const grpcOpts = data['grpc-opts'] ?? {}
  const h2Opts = data['h2-opts'] ?? {}
  const httpOpts = data['http-opts'] ?? {}
  const realityOpts = data['reality-opts'] ?? {}
  const peer = Array.isArray(data.peers) ? (data.peers[0] ?? {}) : {}

  form.type = type
  form.name = toText(data.name)
  form.server = toText(data.server)
  form.port = toText(data.port)
  form.username = toText(data.username)
  form.password = toText(data.password)
  form.cipher = (data.cipher ?? form.cipher) as CipherType
  form.uuid = toText(data.uuid)
  form.alterId = toText(data.alterId ?? form.alterId)
  form.network = (data.network ?? form.network) as NetworkType
  form.tls = toBoolean(data.tls)
  form.udp = data.udp !== undefined ? toBoolean(data.udp) : form.udp
  form.tfo = toBoolean(data.tfo)
  form.skipCertVerify = toBoolean(data['skip-cert-verify'])
  form.sni = toText(data.sni)
  form.servername = toText(data.servername)
  form.alpn = joinTextList(data.alpn)
  form.fingerprint = toText(data.fingerprint)
  form.clientFingerprint = (data['client-fingerprint'] ??
    form.clientFingerprint) as ManualProxyForm['clientFingerprint']
  form.flow = toText(data.flow)
  form.wsPath = toText(wsOpts.path ?? data['ws-path'])
  form.wsHost = firstText(wsHeaders.Host ?? wsHeaders.host)
  form.grpcServiceName = toText(grpcOpts['grpc-service-name'])
  form.h2Path = firstText(h2Opts.path ?? httpOpts.path)
  form.h2Host = firstText(h2Opts.host ?? httpOpts.headers?.Host)
  form.realityPublicKey = toText(realityOpts['public-key'])
  form.realityShortId = toText(realityOpts['short-id'])
  form.ssPlugin = ['obfs', 'v2ray-plugin'].includes(data.plugin)
    ? data.plugin
    : ''
  form.pluginMode = toText(pluginOpts.mode) || form.pluginMode
  form.pluginHost = toText(pluginOpts.host)
  form.pluginPath = toText(pluginOpts.path)
  form.ssrProtocol = toText(data.protocol) || form.ssrProtocol
  form.ssrObfs = toText(data.obfs) || form.ssrObfs
  form.ssrProtocolParam = toText(data['protocol-param'])
  form.ssrObfsParam = toText(data['obfs-param'])
  form.auth = toText(data['auth-str'] ?? data.auth)
  form.obfs = toText(data.obfs)
  form.obfsPassword = toText(data['obfs-password'])
  form.up = toText(data.up ?? data['up-speed'])
  form.down = toText(data.down ?? data['down-speed'])
  form.ports = toText(data.ports)
  form.token = toText(data.token)
  form.congestionController =
    toText(data['congestion-controller']) || form.congestionController
  form.ip = toText(data.ip)
  form.ipv6 = toText(data.ipv6)
  form.privateKey = toText(data['private-key'])
  form.publicKey = toText(data['public-key'] ?? peer['public-key'])
  form.preSharedKey = toText(data['pre-shared-key'] ?? peer['pre-shared-key'])
  form.dns = joinTextList(data.dns)
  form.mtu = toText(data.mtu)
  form.persistentKeepalive = toText(data['persistent-keepalive'])
  form.ipVersion = (data['ip-version'] ?? '') as ManualProxyForm['ipVersion']
  form.interfaceName = toText(data['interface-name'])
  form.dialerProxy = toText(data['dialer-proxy'])

  return form
}

const setIf = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  if (value === undefined || value === null || value === '') return
  if (Array.isArray(value) && value.length === 0) return
  target[key] = value
}

const compactObject = <T extends Record<string, unknown>>(input: T) => {
  const output: Record<string, unknown> = {}
  Object.entries(input).forEach(([key, value]) => setIf(output, key, value))
  return output
}

const createsDialerCycle = (
  name: string,
  dialerProxy: string,
  dialerProxyMap: Record<string, string>,
) => {
  const nextDialerMap = new Map(Object.entries(dialerProxyMap))
  nextDialerMap.set(name, dialerProxy)

  const visited = new Set<string>()
  let cursor = dialerProxy

  while (cursor) {
    if (cursor === name) return true
    if (visited.has(cursor)) return false
    visited.add(cursor)
    cursor = nextDialerMap.get(cursor) ?? ''
  }

  return false
}

const validateForm = (
  form: ManualProxyForm,
  existingNames: Set<string>,
  dialerProxyMap: Record<string, string>,
  tr: (key: string) => string,
) => {
  const errors: FormErrors = {}
  const name = form.name.trim()
  const port = toNumber(form.port)
  const dialerProxy = form.dialerProxy.trim()

  if (!name) errors.name = tr('errors.nameRequired')
  if (name && existingNames.has(name)) errors.name = tr('errors.nameExists')
  if (name && dialerProxy === name) {
    errors.dialerProxy = tr('errors.dialerSelf')
  } else if (
    name &&
    dialerProxy &&
    createsDialerCycle(name, dialerProxy, dialerProxyMap)
  ) {
    errors.dialerProxy = tr('errors.dialerCycle')
  }

  if (!form.server.trim()) errors.server = tr('errors.serverRequired')
  if (!form.port.trim()) {
    errors.port = tr('errors.portRequired')
  } else if (!port || port < 1 || port > 65535) {
    errors.port = tr('errors.portInvalid')
  }

  if (['ss', 'ssr', 'trojan', 'hysteria2', 'anytls'].includes(form.type)) {
    if (!form.password.trim()) errors.password = tr('errors.passwordRequired')
  }

  if (form.type === 'hysteria' && !form.auth.trim()) {
    errors.auth = tr('errors.authRequired')
  }

  if (['vmess', 'vless'].includes(form.type) && !form.uuid.trim()) {
    errors.uuid = tr('errors.uuidRequired')
  }

  if (form.type === 'tuic' && !form.token.trim()) {
    if (!form.uuid.trim()) errors.uuid = tr('errors.uuidRequired')
    if (!form.password.trim()) errors.password = tr('errors.passwordRequired')
  }

  if (form.type === 'wireguard') {
    if (!form.privateKey.trim()) {
      errors.privateKey = tr('errors.privateKeyRequired')
    }
    if (!form.publicKey.trim()) {
      errors.publicKey = tr('errors.publicKeyRequired')
    }
    if (!form.ip.trim() && !form.ipv6.trim()) {
      errors.ip = tr('errors.ipRequired')
    }
  }

  return errors
}

const applyBaseOptions = (
  proxy: Record<string, unknown>,
  form: ManualProxyForm,
) => {
  if (form.udp) setIf(proxy, 'udp', true)
  if (form.tfo) setIf(proxy, 'tfo', true)
  setIf(proxy, 'interface-name', form.interfaceName.trim())
  setIf(proxy, 'dialer-proxy', form.dialerProxy.trim())
  setIf(proxy, 'ip-version', form.ipVersion)
}

const applyTlsOptions = (
  proxy: Record<string, unknown>,
  form: ManualProxyForm,
) => {
  if (form.tls) setIf(proxy, 'tls', true)
  if (form.skipCertVerify) setIf(proxy, 'skip-cert-verify', true)
  setIf(proxy, 'sni', form.sni.trim())
  setIf(proxy, 'servername', form.servername.trim())
  setIf(proxy, 'fingerprint', form.fingerprint.trim())
  if (['trojan', 'vmess', 'vless', 'anytls'].includes(form.type)) {
    setIf(proxy, 'client-fingerprint', form.clientFingerprint)
  }

  const alpn = splitList(form.alpn)
  if (
    alpn.length > 0 &&
    [
      'trojan',
      'vmess',
      'vless',
      'hysteria2',
      'hysteria',
      'tuic',
      'anytls',
    ].includes(form.type)
  ) {
    setIf(proxy, 'alpn', alpn)
  }
}

const applyTransportOptions = (
  proxy: Record<string, unknown>,
  form: ManualProxyForm,
) => {
  setIf(proxy, 'network', form.network)

  if (form.network === 'ws') {
    const wsOpts = compactObject({
      path: form.wsPath.trim(),
      headers: form.wsHost.trim() ? { Host: form.wsHost.trim() } : undefined,
    })
    if (Object.keys(wsOpts).length > 0) setIf(proxy, 'ws-opts', wsOpts)
  }

  if (form.network === 'grpc') {
    const grpcOpts = compactObject({
      'grpc-service-name': form.grpcServiceName.trim(),
    })
    if (Object.keys(grpcOpts).length > 0) setIf(proxy, 'grpc-opts', grpcOpts)
  }

  if (form.network === 'h2') {
    const h2Opts = compactObject({
      path: form.h2Path.trim(),
      host: form.h2Host.trim(),
    })
    if (Object.keys(h2Opts).length > 0) setIf(proxy, 'h2-opts', h2Opts)
  }

  if (form.network === 'http') {
    const httpOpts = compactObject({
      path: form.h2Path.trim() ? [form.h2Path.trim()] : undefined,
      headers: form.h2Host.trim() ? { Host: [form.h2Host.trim()] } : undefined,
    })
    if (Object.keys(httpOpts).length > 0) setIf(proxy, 'http-opts', httpOpts)
  }
}

const buildProxy = (form: ManualProxyForm): IProxyConfig => {
  const proxy: Record<string, unknown> = {
    name: form.name.trim(),
    type: form.type,
    server: form.server.trim(),
    port: toNumber(form.port),
  }

  applyBaseOptions(proxy, form)

  switch (form.type) {
    case 'ss':
      setIf(proxy, 'cipher', form.cipher)
      setIf(proxy, 'password', form.password.trim())
      if (form.ssPlugin) {
        setIf(proxy, 'plugin', form.ssPlugin)
        if (form.ssPlugin === 'obfs') {
          setIf(
            proxy,
            'plugin-opts',
            compactObject({
              mode: form.pluginMode,
              host: form.pluginHost.trim(),
            }),
          )
        } else if (form.ssPlugin === 'v2ray-plugin') {
          setIf(
            proxy,
            'plugin-opts',
            compactObject({
              mode: 'websocket',
              host: form.pluginHost.trim(),
              path: form.pluginPath.trim(),
              tls: form.tls ? 'true' : undefined,
            }),
          )
        }
      }
      break

    case 'ssr':
      setIf(proxy, 'cipher', form.cipher)
      setIf(proxy, 'password', form.password.trim())
      setIf(proxy, 'protocol', form.ssrProtocol.trim())
      setIf(proxy, 'obfs', form.ssrObfs.trim())
      setIf(proxy, 'protocol-param', form.ssrProtocolParam.trim())
      setIf(proxy, 'obfs-param', form.ssrObfsParam.trim())
      break

    case 'socks5':
      setIf(proxy, 'username', form.username.trim())
      setIf(proxy, 'password', form.password.trim())
      applyTlsOptions(proxy, form)
      break

    case 'http':
      setIf(proxy, 'username', form.username.trim())
      setIf(proxy, 'password', form.password.trim())
      applyTlsOptions(proxy, form)
      break

    case 'trojan':
      setIf(proxy, 'password', form.password.trim())
      applyTlsOptions(proxy, form)
      applyTransportOptions(proxy, form)
      break

    case 'vmess':
      setIf(proxy, 'uuid', form.uuid.trim())
      setIf(proxy, 'alterId', toNumber(form.alterId) ?? 0)
      setIf(proxy, 'cipher', form.cipher)
      applyTlsOptions(proxy, form)
      applyTransportOptions(proxy, form)
      break

    case 'vless':
      setIf(proxy, 'uuid', form.uuid.trim())
      setIf(proxy, 'flow', form.flow.trim())
      applyTlsOptions(proxy, form)
      applyTransportOptions(proxy, form)
      if (form.realityPublicKey.trim() || form.realityShortId.trim()) {
        setIf(proxy, 'tls', true)
        setIf(
          proxy,
          'reality-opts',
          compactObject({
            'public-key': form.realityPublicKey.trim(),
            'short-id': form.realityShortId.trim(),
          }),
        )
      }
      break

    case 'hysteria2':
      setIf(proxy, 'password', form.password.trim())
      setIf(proxy, 'ports', form.ports.trim())
      setIf(proxy, 'up', form.up.trim())
      setIf(proxy, 'down', form.down.trim())
      setIf(proxy, 'obfs', form.obfs.trim())
      setIf(proxy, 'obfs-password', form.obfsPassword.trim())
      applyTlsOptions(proxy, form)
      break

    case 'hysteria':
      setIf(proxy, 'auth-str', form.auth.trim())
      setIf(proxy, 'ports', form.ports.trim())
      setIf(proxy, 'up', form.up.trim())
      setIf(proxy, 'down', form.down.trim())
      setIf(proxy, 'obfs', form.obfs.trim())
      applyTlsOptions(proxy, form)
      break

    case 'tuic':
      setIf(proxy, 'token', form.token.trim())
      setIf(proxy, 'uuid', form.uuid.trim())
      setIf(proxy, 'password', form.password.trim())
      setIf(proxy, 'congestion-controller', form.congestionController.trim())
      applyTlsOptions(proxy, form)
      break

    case 'wireguard':
      setIf(proxy, 'private-key', form.privateKey.trim())
      setIf(proxy, 'public-key', form.publicKey.trim())
      setIf(proxy, 'pre-shared-key', form.preSharedKey.trim())
      setIf(proxy, 'ip', form.ip.trim())
      setIf(proxy, 'ipv6', form.ipv6.trim())
      setIf(proxy, 'mtu', toNumber(form.mtu))
      setIf(proxy, 'persistent-keepalive', toNumber(form.persistentKeepalive))
      {
        const dns = splitList(form.dns)
        if (dns.length > 0) setIf(proxy, 'dns', dns)
      }
      break

    case 'anytls':
      setIf(proxy, 'password', form.password.trim())
      applyTlsOptions(proxy, form)
      break
  }

  return proxy as unknown as IProxyConfig
}

const ManualProxyViewerContent = (props: ManualProxyViewerProps) => {
  const {
    open,
    existingNames,
    proxyOptions = EMPTY_PROXY_OPTIONS,
    dialerProxyMap = EMPTY_DIALER_PROXY_MAP,
    mode = 'add',
    initialProxy,
    onClose,
    onAdd,
    onSave,
  } = props
  const { t } = useTranslation()
  const tr = (key: string) => t(`${TR_PREFIX}.${key}` as any)
  const isEdit = mode === 'edit'
  const initialProxyForm = useMemo(
    () => proxyToForm(initialProxy),
    [initialProxy],
  )
  const [form, setForm] = useState<ManualProxyForm>(initialProxyForm)
  const [stableProxyOptions] = useState(() =>
    Array.from(
      new Set(
        [...proxyOptions, initialProxyForm.dialerProxy].filter(
          (name): name is string => typeof name === 'string' && !!name,
        ),
      ),
    ),
  )
  const [errors, setErrors] = useState<FormErrors>({})

  const existingNameSet = useMemo(
    () => new Set(existingNames.filter(Boolean)),
    [existingNames],
  )

  const resetForm = () => {
    setForm(initialProxyForm)
    setErrors({})
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const setField = <Key extends keyof ManualProxyForm>(
    key: Key,
    value: ManualProxyForm[Key],
  ) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'type') {
        const nextType = value as ManualProxyProtocol
        next.port = PROTOCOL_PORTS[nextType] ?? ''
        next.tls = ['trojan', 'vmess', 'vless', 'hysteria2', 'tuic'].includes(
          nextType,
        )
        next.network = 'tcp'
        next.cipher = nextType === 'vmess' ? 'auto' : 'aes-128-gcm'
      }
      return next
    })
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const handleSubmit = (placement?: AddPlacement) => {
    const nextErrors = validateForm(form, existingNameSet, dialerProxyMap, tr)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const proxy = buildProxy(form)
    if (isEdit) {
      onSave?.(proxy)
    } else if (placement) {
      onAdd(proxy, placement)
    }
    handleClose()
  }

  const showTransport = hasTransportOptions(form.type)
  const showTls = hasTlsOptions(form.type)
  const showPlugin = form.type === 'ss'
  const showSsr = form.type === 'ssr'
  const showWireguard = form.type === 'wireguard'
  const showHysteria = form.type === 'hysteria' || form.type === 'hysteria2'
  const showCredential =
    !showWireguard &&
    !['vmess', 'vless'].includes(form.type) &&
    form.type !== 'hysteria'

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xl" fullWidth>
      <DialogTitle
        sx={{
          px: 3,
          py: 2,
          fontSize: 24,
          fontWeight: 800,
        }}
      >
        {isEdit ? tr('editTitle') : tr('title')}
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ px: 3, py: 2.5 }}>
          <TopGrid>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label={tr('fields.name')}
              placeholder={tr('placeholders.name')}
              value={form.name}
              error={!!errors.name}
              helperText={errors.name}
              onChange={(event) => setField('name', event.target.value)}
            />

            <TextField
              select
              fullWidth
              size="small"
              label={tr('fields.protocol')}
              value={form.type}
              onChange={(event) =>
                setField('type', event.target.value as ManualProxyProtocol)
              }
            >
              {PROTOCOL_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </TopGrid>

          <SectionGrid>
            <Section title={tr('sections.server')}>
              <FieldRow>
                <TextField
                  fullWidth
                  size="small"
                  label={tr('fields.server')}
                  placeholder="example.com"
                  value={form.server}
                  error={!!errors.server}
                  helperText={errors.server}
                  onChange={(event) => setField('server', event.target.value)}
                />
                <TextField
                  size="small"
                  label={tr('fields.port')}
                  placeholder="443"
                  value={form.port}
                  error={!!errors.port}
                  helperText={errors.port}
                  onChange={(event) => setField('port', event.target.value)}
                  sx={{ width: 128, flexShrink: 0 }}
                />
              </FieldRow>

              {['http', 'socks5'].includes(form.type) && (
                <FieldRow>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.username')}
                    value={form.username}
                    onChange={(event) =>
                      setField('username', event.target.value)
                    }
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.password')}
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      setField('password', event.target.value)
                    }
                  />
                </FieldRow>
              )}

              {showCredential && !['http', 'socks5'].includes(form.type) && (
                <TextField
                  fullWidth
                  size="small"
                  label={
                    form.type === 'tuic'
                      ? tr('fields.tuicPassword')
                      : tr('fields.password')
                  }
                  type="password"
                  value={form.password}
                  error={!!errors.password}
                  helperText={errors.password}
                  onChange={(event) => setField('password', event.target.value)}
                />
              )}

              {form.type === 'hysteria' && (
                <TextField
                  fullWidth
                  size="small"
                  label={tr('fields.auth')}
                  value={form.auth}
                  error={!!errors.auth}
                  helperText={errors.auth}
                  onChange={(event) => setField('auth', event.target.value)}
                />
              )}
            </Section>

            <Section title={tr('sections.protocol')}>
              {['ss', 'ssr'].includes(form.type) && (
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={tr('fields.cipher')}
                  value={form.cipher}
                  onChange={(event) =>
                    setField('cipher', event.target.value as CipherType)
                  }
                >
                  {CIPHER_OPTIONS.map((cipher) => (
                    <MenuItem key={cipher} value={cipher}>
                      {cipher}
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {form.type === 'vmess' && (
                <>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.uuid')}
                    value={form.uuid}
                    error={!!errors.uuid}
                    helperText={errors.uuid}
                    onChange={(event) => setField('uuid', event.target.value)}
                  />
                  <FieldRow>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={tr('fields.cipher')}
                      value={form.cipher}
                      onChange={(event) =>
                        setField('cipher', event.target.value as CipherType)
                      }
                    >
                      {VMESS_CIPHER_OPTIONS.map((cipher) => (
                        <MenuItem key={cipher} value={cipher}>
                          {cipher}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small"
                      label={tr('fields.alterId')}
                      value={form.alterId}
                      onChange={(event) =>
                        setField('alterId', event.target.value)
                      }
                      sx={{ width: 128, flexShrink: 0 }}
                    />
                  </FieldRow>
                </>
              )}

              {form.type === 'vless' && (
                <>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.uuid')}
                    value={form.uuid}
                    error={!!errors.uuid}
                    helperText={errors.uuid}
                    onChange={(event) => setField('uuid', event.target.value)}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.flow')}
                    placeholder="xtls-rprx-vision"
                    value={form.flow}
                    onChange={(event) => setField('flow', event.target.value)}
                  />
                </>
              )}

              {form.type === 'tuic' && (
                <>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.token')}
                    value={form.token}
                    onChange={(event) => setField('token', event.target.value)}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.uuid')}
                    value={form.uuid}
                    error={!!errors.uuid}
                    helperText={errors.uuid}
                    onChange={(event) => setField('uuid', event.target.value)}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.congestionController')}
                    value={form.congestionController}
                    onChange={(event) =>
                      setField('congestionController', event.target.value)
                    }
                  />
                </>
              )}

              {showHysteria && (
                <>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.ports')}
                    value={form.ports}
                    onChange={(event) => setField('ports', event.target.value)}
                  />
                  <FieldRow>
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.up')}
                      placeholder="50 Mbps"
                      value={form.up}
                      onChange={(event) => setField('up', event.target.value)}
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.down')}
                      placeholder="200 Mbps"
                      value={form.down}
                      onChange={(event) => setField('down', event.target.value)}
                    />
                  </FieldRow>
                </>
              )}

              {showWireguard && (
                <>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.privateKey')}
                    value={form.privateKey}
                    error={!!errors.privateKey}
                    helperText={errors.privateKey}
                    onChange={(event) =>
                      setField('privateKey', event.target.value)
                    }
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.publicKey')}
                    value={form.publicKey}
                    error={!!errors.publicKey}
                    helperText={errors.publicKey}
                    onChange={(event) =>
                      setField('publicKey', event.target.value)
                    }
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.preSharedKey')}
                    value={form.preSharedKey}
                    onChange={(event) =>
                      setField('preSharedKey', event.target.value)
                    }
                  />
                </>
              )}

              {showSsr && (
                <>
                  <FieldRow>
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.ssrProtocol')}
                      value={form.ssrProtocol}
                      onChange={(event) =>
                        setField('ssrProtocol', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.ssrObfs')}
                      value={form.ssrObfs}
                      onChange={(event) =>
                        setField('ssrObfs', event.target.value)
                      }
                    />
                  </FieldRow>
                  <FieldRow>
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.protocolParam')}
                      value={form.ssrProtocolParam}
                      onChange={(event) =>
                        setField('ssrProtocolParam', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.obfsParam')}
                      value={form.ssrObfsParam}
                      onChange={(event) =>
                        setField('ssrObfsParam', event.target.value)
                      }
                    />
                  </FieldRow>
                </>
              )}
            </Section>

            {showTransport && (
              <Section title={tr('sections.transport')}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={tr('fields.network')}
                  value={form.network}
                  onChange={(event) =>
                    setField('network', event.target.value as NetworkType)
                  }
                >
                  {NETWORK_OPTIONS.map((network) => (
                    <MenuItem key={network} value={network}>
                      {network.toUpperCase()}
                    </MenuItem>
                  ))}
                </TextField>

                {form.network === 'ws' && (
                  <FieldRow>
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.wsPath')}
                      value={form.wsPath}
                      onChange={(event) =>
                        setField('wsPath', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.wsHost')}
                      value={form.wsHost}
                      onChange={(event) =>
                        setField('wsHost', event.target.value)
                      }
                    />
                  </FieldRow>
                )}

                {form.network === 'grpc' && (
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.grpcServiceName')}
                    value={form.grpcServiceName}
                    onChange={(event) =>
                      setField('grpcServiceName', event.target.value)
                    }
                  />
                )}

                {(form.network === 'h2' || form.network === 'http') && (
                  <FieldRow>
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.h2Path')}
                      value={form.h2Path}
                      onChange={(event) =>
                        setField('h2Path', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.h2Host')}
                      value={form.h2Host}
                      onChange={(event) =>
                        setField('h2Host', event.target.value)
                      }
                    />
                  </FieldRow>
                )}
              </Section>
            )}

            {showTls && (
              <Section title={tr('sections.tls')}>
                <OptionGrid>
                  {['http', 'socks5', 'vmess', 'vless'].includes(form.type) && (
                    <CheckOption
                      checked={form.tls}
                      label={tr('toggles.tls')}
                      onChange={(checked) => setField('tls', checked)}
                    />
                  )}
                  <CheckOption
                    checked={form.skipCertVerify}
                    label={tr('toggles.skipCertVerify')}
                    onChange={(checked) => setField('skipCertVerify', checked)}
                  />
                </OptionGrid>

                <FieldRow>
                  <TextField
                    fullWidth
                    size="small"
                    label={
                      ['vmess', 'vless'].includes(form.type)
                        ? tr('fields.servername')
                        : tr('fields.sni')
                    }
                    value={
                      ['vmess', 'vless'].includes(form.type)
                        ? form.servername
                        : form.sni
                    }
                    onChange={(event) =>
                      ['vmess', 'vless'].includes(form.type)
                        ? setField('servername', event.target.value)
                        : setField('sni', event.target.value)
                    }
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.alpn')}
                    placeholder="h2,http/1.1"
                    value={form.alpn}
                    onChange={(event) => setField('alpn', event.target.value)}
                  />
                </FieldRow>

                <FieldRow>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.fingerprint')}
                    value={form.fingerprint}
                    onChange={(event) =>
                      setField('fingerprint', event.target.value)
                    }
                  />
                  {['trojan', 'vmess', 'vless', 'anytls'].includes(
                    form.type,
                  ) && (
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={tr('fields.clientFingerprint')}
                      value={form.clientFingerprint}
                      onChange={(event) =>
                        setField(
                          'clientFingerprint',
                          event.target.value as ClientFingerprint,
                        )
                      }
                    >
                      {CLIENT_FINGERPRINT_OPTIONS.map((fingerprint) => (
                        <MenuItem key={fingerprint} value={fingerprint}>
                          {fingerprint}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                </FieldRow>

                {form.type === 'vless' && (
                  <FieldRow>
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.realityPublicKey')}
                      value={form.realityPublicKey}
                      onChange={(event) =>
                        setField('realityPublicKey', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.realityShortId')}
                      value={form.realityShortId}
                      onChange={(event) =>
                        setField('realityShortId', event.target.value)
                      }
                    />
                  </FieldRow>
                )}
              </Section>
            )}

            {showPlugin && (
              <Section title={tr('sections.plugin')}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={tr('fields.plugin')}
                  value={form.ssPlugin}
                  onChange={(event) =>
                    setField(
                      'ssPlugin',
                      event.target.value as ManualProxyForm['ssPlugin'],
                    )
                  }
                >
                  <MenuItem value="">{tr('options.none')}</MenuItem>
                  <MenuItem value="obfs">simple-obfs</MenuItem>
                  <MenuItem value="v2ray-plugin">v2ray-plugin</MenuItem>
                </TextField>

                {form.ssPlugin && (
                  <FieldRow>
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.pluginMode')}
                      value={form.pluginMode}
                      onChange={(event) =>
                        setField('pluginMode', event.target.value)
                      }
                    />
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.pluginHost')}
                      value={form.pluginHost}
                      onChange={(event) =>
                        setField('pluginHost', event.target.value)
                      }
                    />
                  </FieldRow>
                )}

                {form.ssPlugin === 'v2ray-plugin' && (
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.pluginPath')}
                    value={form.pluginPath}
                    onChange={(event) =>
                      setField('pluginPath', event.target.value)
                    }
                  />
                )}
              </Section>
            )}

            {showHysteria && (
              <Section title={tr('sections.obfs')}>
                <FieldRow>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.obfs')}
                    value={form.obfs}
                    onChange={(event) => setField('obfs', event.target.value)}
                  />
                  {form.type === 'hysteria2' && (
                    <TextField
                      fullWidth
                      size="small"
                      label={tr('fields.obfsPassword')}
                      type="password"
                      value={form.obfsPassword}
                      onChange={(event) =>
                        setField('obfsPassword', event.target.value)
                      }
                    />
                  )}
                </FieldRow>
              </Section>
            )}

            {showWireguard && (
              <Section title={tr('sections.interface')}>
                <FieldRow>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.ip')}
                    value={form.ip}
                    error={!!errors.ip}
                    helperText={errors.ip}
                    onChange={(event) => setField('ip', event.target.value)}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.ipv6')}
                    value={form.ipv6}
                    onChange={(event) => setField('ipv6', event.target.value)}
                  />
                </FieldRow>
                <TextField
                  fullWidth
                  size="small"
                  label={tr('fields.dns')}
                  value={form.dns}
                  onChange={(event) => setField('dns', event.target.value)}
                />
                <FieldRow>
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.mtu')}
                    value={form.mtu}
                    onChange={(event) => setField('mtu', event.target.value)}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    label={tr('fields.persistentKeepalive')}
                    value={form.persistentKeepalive}
                    onChange={(event) =>
                      setField('persistentKeepalive', event.target.value)
                    }
                  />
                </FieldRow>
              </Section>
            )}

            <Section title={tr('sections.options')}>
              <OptionGrid>
                {form.type !== 'http' && (
                  <CheckOption
                    checked={form.udp}
                    label={tr('toggles.udp')}
                    onChange={(checked) => setField('udp', checked)}
                  />
                )}
                <CheckOption
                  checked={form.tfo}
                  label={tr('toggles.tfo')}
                  onChange={(checked) => setField('tfo', checked)}
                />
              </OptionGrid>

              <FieldRow>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label={tr('fields.ipVersion')}
                  value={form.ipVersion}
                  onChange={(event) =>
                    setField(
                      'ipVersion',
                      event.target.value as ManualProxyForm['ipVersion'],
                    )
                  }
                >
                  <MenuItem value="">{tr('options.default')}</MenuItem>
                  {IP_VERSION_OPTIONS.map((ipVersion) => (
                    <MenuItem key={ipVersion} value={ipVersion}>
                      {ipVersion}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  fullWidth
                  size="small"
                  label={tr('fields.interfaceName')}
                  value={form.interfaceName}
                  onChange={(event) =>
                    setField('interfaceName', event.target.value)
                  }
                />
              </FieldRow>

              <TextField
                select
                fullWidth
                size="small"
                label={tr('fields.dialerProxy')}
                value={form.dialerProxy}
                error={!!errors.dialerProxy}
                helperText={errors.dialerProxy}
                onChange={(event) =>
                  setField('dialerProxy', event.target.value)
                }
              >
                <MenuItem value="">{tr('options.none')}</MenuItem>
                {stableProxyOptions
                  .filter(
                    (proxyName) =>
                      proxyName !== form.name.trim() ||
                      proxyName === form.dialerProxy,
                  )
                  .map((proxyName) => (
                    <MenuItem
                      key={proxyName}
                      value={proxyName}
                      disabled={proxyName === form.name.trim()}
                    >
                      {proxyName}
                    </MenuItem>
                  ))}
              </TextField>
            </Section>
          </SectionGrid>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} variant="outlined">
          {t('shared.actions.cancel')}
        </Button>
        {isEdit ? (
          <Button
            variant="contained"
            startIcon={<SaveRounded />}
            onClick={() => handleSubmit()}
          >
            {t('shared.actions.save')}
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => handleSubmit('prepend')}
            >
              {tr('actions.prepend')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => handleSubmit('append')}
            >
              {tr('actions.append')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

export const ManualProxyViewer = (props: ManualProxyViewerProps) => {
  const { open, initialProxy, mode } = props
  if (!open) return null

  const key = initialProxy
    ? `${mode ?? 'add'}:${initialProxy.name}:${initialProxy.type}`
    : `${mode ?? 'add'}:new`

  return <ManualProxyViewerContent key={key} {...props} />
}

const Section = (props: { title: string; children: React.ReactNode }) => {
  const { title, children } = props
  return (
    <SectionShell>
      <SectionTitle variant="subtitle2">{title}</SectionTitle>
      <Box sx={{ display: 'grid', gap: 1.5 }}>{children}</Box>
    </SectionShell>
  )
}

const CheckOption = (props: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) => {
  const { checked, label, onChange } = props
  return (
    <FormControlLabel
      control={
        <Checkbox
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          size="small"
        />
      }
      label={label}
      sx={{
        m: 0,
        '& .MuiFormControlLabel-label': {
          fontSize: 14,
          fontWeight: 600,
        },
      }}
    />
  )
}

const TopGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) minmax(220px, 360px)',
  gap: theme.spacing(2),
  marginBottom: theme.spacing(2.5),
  [theme.breakpoints.down('md')]: {
    gridTemplateColumns: '1fr',
  },
}))

const SectionGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(260px, 1fr))',
  gap: theme.spacing(2),
  alignItems: 'start',
  [theme.breakpoints.down('lg')]: {
    gridTemplateColumns: 'repeat(2, minmax(260px, 1fr))',
  },
  [theme.breakpoints.down('md')]: {
    gridTemplateColumns: '1fr',
  },
}))

const SectionShell = styled(Box)(({ theme }) => ({
  position: 'relative',
  border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
  borderRadius: 8,
  padding: theme.spacing(2),
  paddingTop: theme.spacing(2.4),
  backgroundColor:
    theme.palette.mode === 'light'
      ? alpha(theme.palette.grey[100], 0.7)
      : alpha(theme.palette.common.white, 0.035),
}))

const SectionTitle = styled(Typography)(({ theme }) => ({
  position: 'absolute',
  top: -12,
  left: 14,
  padding: `0 ${theme.spacing(0.75)}`,
  fontSize: 13,
  fontWeight: 800,
  color: theme.palette.text.secondary,
  backgroundColor: theme.palette.background.paper,
}))

const FieldRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1.2),
  alignItems: 'flex-start',
  [theme.breakpoints.down('sm')]: {
    flexDirection: 'column',
  },
}))

const OptionGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: theme.spacing(0.75),
  [theme.breakpoints.down('sm')]: {
    gridTemplateColumns: '1fr',
  },
}))
