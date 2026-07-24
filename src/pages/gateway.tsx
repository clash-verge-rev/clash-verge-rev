import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import RouterOutlinedIcon from '@mui/icons-material/RouterOutlined'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tabs,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import { useClash } from '@/hooks/use-clash'
import { useConnectionData } from '@/hooks/use-connection-data'
import { useNetworkInterfaces } from '@/hooks/use-network'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import {
  getGatewayStatus,
  getDhcpServerStatus,
  installService,
  isServiceAvailable,
  restartCore,
  startDhcpServer,
  stopDhcpServer,
  type DhcpServerStatus,
  setGatewayForwarding,
  type GatewayStatus,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import parseTraffic from '@/utils/parse-traffic'

const formatRate = (bytes: number) => {
  const [value, unit] = parseTraffic(Math.max(0, bytes))
  return `${value} ${unit}/s`
}

const formatTotal = (bytes: number) => {
  const [value, unit] = parseTraffic(Math.max(0, bytes))
  return `${value} ${unit}`
}

const DEVICE_ICONS = [
  '📱',
  '💻',
  '🖥️',
  '📺',
  '🎮',
  '📡',
  '🔌',
  '💡',
  '🖨️',
  '📷',
  '🏠',
  '❓',
]

type GatewayDeviceProfile = {
  mac_address: string
  name: string
  icon: string
  fixed_ip: string
  last_ip?: string
  last_seen?: number
  owner?: string
  group?: string
  notes?: string
  trusted?: boolean
  internet_blocked?: boolean
  blocked_domains?: string[]
  blocked_ports?: number[]
  blocked_ports_text?: string
}

const DEVICE_GROUPS = [
  'family',
  'guest',
  'iot',
  'work',
  'infrastructure',
  'unknown',
]
const deviceGroupLabel = (group: string) => {
  switch (group) {
    case 'family':
      return 'gateway.page.group_family' as const
    case 'guest':
      return 'gateway.page.group_guest' as const
    case 'iot':
      return 'gateway.page.group_iot' as const
    case 'work':
      return 'gateway.page.group_work' as const
    case 'infrastructure':
      return 'gateway.page.group_infrastructure' as const
    default:
      return 'gateway.page.group_unknown' as const
  }
}

const ipv4Of = (networkInterface?: INetworkInterface) =>
  networkInterface?.addr.find(
    (address) => address.V4 && !address.V4.ip.startsWith('169.254.'),
  )?.V4?.ip ??
  networkInterface?.addr.find((address) => address.V4)?.V4?.ip ??
  ''

const ipv4ToNumber = (address: string) => {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null
  }
  return octets.reduce((result, octet) => (result << 8) | octet, 0) >>> 0
}

const isDownstreamSource = (
  sourceIP: string,
  router: string,
  subnetMask: string,
) => {
  const source = ipv4ToNumber(sourceIP)
  const gateway = ipv4ToNumber(router)
  const mask = ipv4ToNumber(subnetMask)
  return (
    source !== null &&
    gateway !== null &&
    mask !== null &&
    source !== gateway &&
    (source & mask) === (gateway & mask)
  )
}

const GatewayPage = () => {
  const { t } = useTranslation()
  const visible = useVisibility()
  const { verge, patchVerge } = useVerge()
  const { clash, patchClash } = useClash()
  const { networkInterfaces } = useNetworkInterfaces()
  const {
    response: { data: connections },
  } = useConnectionData({ enabled: visible })
  const saved = verge?.gateway_mode
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [lanInterface, setLanInterface] = useState(saved?.lan_interface ?? '')
  const [dnsAddress, setDnsAddress] = useState(
    saved?.dns_address ?? '198.18.0.2',
  )
  const [hijackDns, setHijackDns] = useState(saved?.hijack_dns ?? true)
  const [panel, setPanel] = useState<'devices' | 'connections' | 'traffic'>(
    'devices',
  )
  const [selectedDevice, setSelectedDevice] = useState('')
  const [dhcpStatus, setDhcpStatus] = useState<DhcpServerStatus | null>(null)
  const [dhcpEnabled, setDhcpEnabled] = useState(saved?.dhcp?.enabled ?? false)
  const [poolStart, setPoolStart] = useState(
    saved?.dhcp?.pool_start ?? '192.168.50.100',
  )
  const [poolEnd, setPoolEnd] = useState(
    saved?.dhcp?.pool_end ?? '192.168.50.200',
  )
  const [subnetMask, setSubnetMask] = useState(
    saved?.dhcp?.subnet_mask ?? '255.255.255.0',
  )
  const [dhcpRouter, setDhcpRouter] = useState(
    saved?.dhcp?.router ?? '192.168.50.1',
  )
  const [dhcpDns, setDhcpDns] = useState(saved?.dhcp?.dns ?? '192.168.50.1')
  const [leaseHours, setLeaseHours] = useState(
    (saved?.dhcp?.lease_time_secs ?? 86400) / 3600,
  )
  const [deviceSearch, setDeviceSearch] = useState('')
  const [editingDevice, setEditingDevice] =
    useState<GatewayDeviceProfile | null>(null)

  useEffect(() => {
    void getGatewayStatus().then(setStatus).catch(console.error)
    void getDhcpServerStatus().then(setDhcpStatus).catch(console.error)
  }, [])

  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => {
      void getDhcpServerStatus().then(setDhcpStatus).catch(console.error)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [visible])

  const effectiveLanInterface =
    lanInterface ||
    networkInterfaces.find(
      (item) => ipv4Of(item) && !ipv4Of(item).startsWith('127.'),
    )?.name ||
    ''

  const selectedInterface = networkInterfaces.find(
    (item) => item.name === effectiveLanInterface,
  )
  const gatewayAddress = ipv4Of(selectedInterface)
  const enabled = saved?.enabled ?? false
  const deviceProfiles = useMemo(() => saved?.devices ?? [], [saved?.devices])
  const reservationsFor = (profiles: GatewayDeviceProfile[]) =>
    profiles
      .filter((profile) => profile.mac_address && profile.fixed_ip)
      .map((profile) => ({
        macAddress: profile.mac_address,
        ipAddress: profile.fixed_ip,
      }))

  const devices = useMemo(() => {
    const grouped = new Map<
      string,
      { connections: number; upload: number; download: number }
    >()
    for (const connection of connections?.activeConnections ?? []) {
      const sourceIP = connection.metadata.sourceIP
      if (!isDownstreamSource(sourceIP, dhcpRouter, subnetMask)) continue
      const item = grouped.get(sourceIP) ?? {
        connections: 0,
        upload: 0,
        download: 0,
      }
      item.connections += 1
      item.upload += connection.curUpload ?? 0
      item.download += connection.curDownload ?? 0
      grouped.set(sourceIP, item)
    }
    return [...grouped.entries()].sort(
      (left, right) =>
        right[1].download +
        right[1].upload -
        (left[1].download + left[1].upload),
    )
  }, [connections?.activeConnections, dhcpRouter, subnetMask])

  const knownDevices = useMemo(() => {
    const result = new Map<
      string,
      {
        hostname: string
        macAddress: string
        connections: number
        upload: number
        download: number
        uploadTotal: number
        downloadTotal: number
        online: boolean
        lastSeen: number
        icon: string
        fixedIp: string
      }
    >()
    for (const lease of dhcpStatus?.leases ?? []) {
      const profile = deviceProfiles.find(
        (item) =>
          item.mac_address.toUpperCase() === lease.macAddress.toUpperCase(),
      )
      result.set(lease.ipAddress, {
        hostname: profile?.name || lease.hostname || lease.ipAddress,
        macAddress: lease.macAddress,
        connections: 0,
        upload: 0,
        download: 0,
        uploadTotal: 0,
        downloadTotal: 0,
        online: lease.expiresAt > Date.now() / 1000,
        lastSeen: lease.lastSeen,
        icon: profile?.icon || '❓',
        fixedIp: profile?.fixed_ip || '',
      })
    }
    for (const profile of deviceProfiles) {
      const sourceIP = profile.fixed_ip || profile.last_ip || ''
      const alreadyListed = [...result.values()].some(
        (item) =>
          item.macAddress.toUpperCase() === profile.mac_address.toUpperCase(),
      )
      if (!sourceIP || result.has(sourceIP) || alreadyListed) continue
      result.set(sourceIP, {
        hostname: profile.name || sourceIP,
        macAddress: profile.mac_address,
        connections: 0,
        upload: 0,
        download: 0,
        uploadTotal: 0,
        downloadTotal: 0,
        online: false,
        lastSeen: profile.last_seen ?? 0,
        icon: profile.icon || '❓',
        fixedIp: profile.fixed_ip || '',
      })
    }
    for (const [sourceIP, live] of devices) {
      const item = result.get(sourceIP) ?? {
        hostname: sourceIP,
        macAddress: '',
        connections: 0,
        upload: 0,
        download: 0,
        uploadTotal: 0,
        downloadTotal: 0,
        online: true,
        lastSeen: Date.now() / 1000,
        icon: '❓',
        fixedIp: '',
      }
      item.connections = live.connections
      item.upload = live.upload
      item.download = live.download
      item.online = true
      for (const connection of connections?.activeConnections ?? []) {
        if (connection.metadata.sourceIP !== sourceIP) continue
        item.uploadTotal += connection.upload
        item.downloadTotal += connection.download
      }
      result.set(sourceIP, item)
    }
    return [...result.entries()].sort((left, right) =>
      left[1].hostname.localeCompare(right[1].hostname),
    )
  }, [
    connections?.activeConnections,
    deviceProfiles,
    devices,
    dhcpStatus?.leases,
  ])

  const visibleDevices = useMemo(() => {
    const query = deviceSearch.trim().toLowerCase()
    if (!query) return knownDevices
    return knownDevices.filter(([sourceIP, item]) => {
      const profile = deviceProfiles.find(
        (candidate) =>
          candidate.mac_address.toUpperCase() === item.macAddress.toUpperCase(),
      )
      return [
        sourceIP,
        item.hostname,
        item.macAddress,
        item.fixedIp,
        profile?.owner,
        profile?.group,
        profile?.notes,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [deviceProfiles, deviceSearch, knownDevices])

  const downstreamConnections = useMemo(
    () =>
      (connections?.activeConnections ?? []).filter((connection) =>
        isDownstreamSource(
          connection.metadata.sourceIP,
          dhcpRouter,
          subnetMask,
        ),
      ),
    [connections?.activeConnections, dhcpRouter, subnetMask],
  )
  const visibleConnections = useMemo(
    () =>
      selectedDevice
        ? downstreamConnections.filter(
            (connection) => connection.metadata.sourceIP === selectedDevice,
          )
        : downstreamConnections,
    [downstreamConnections, selectedDevice],
  )

  const updateDevicePolicy = useLockFn(
    async (sourceIP: string, policy: string) => {
      if (!saved) return
      const policies = saved.device_policies.filter(
        (item) => item.source_ip !== sourceIP,
      )
      if (policy) policies.push({ source_ip: sourceIP, policy })
      await patchVerge({
        gateway_mode: { ...saved, device_policies: policies },
      }).catch(showNotice.error)
    },
  )

  const updateDeviceInternet = useLockFn(
    async (
      macAddress: string,
      sourceIP: string,
      hostname: string,
      icon: string,
      blocked: boolean,
    ) => {
      if (!saved || !macAddress) return
      const normalizedMac = macAddress.toUpperCase()
      const exists = deviceProfiles.some(
        (profile) => profile.mac_address.toUpperCase() === normalizedMac,
      )
      const nextDevices = exists
        ? deviceProfiles.map((profile) =>
            profile.mac_address.toUpperCase() === normalizedMac
              ? {
                  ...profile,
                  last_ip: sourceIP,
                  internet_blocked: blocked,
                }
              : profile,
          )
        : [
            ...deviceProfiles,
            {
              mac_address: normalizedMac,
              name: hostname === sourceIP ? '' : hostname,
              icon,
              fixed_ip: '',
              last_ip: sourceIP,
              last_seen: Math.floor(Date.now() / 1000),
              owner: '',
              group: 'unknown',
              notes: '',
              trusted: false,
              internet_blocked: blocked,
              blocked_domains: [],
              blocked_ports: [],
            },
          ]
      await patchVerge({
        gateway_mode: { ...saved, devices: nextDevices },
      })
        .then(() =>
          showNotice.success(
            t(
              blocked
                ? 'gateway.page.internetPaused'
                : 'gateway.page.internetResumed',
            ),
          ),
        )
        .catch(showNotice.error)
    },
  )

  const saveDevice = useLockFn(async () => {
    if (!saved || !editingDevice) return
    const macAddress = editingDevice.mac_address.trim().toUpperCase()
    const fixedIp = editingDevice.fixed_ip.trim()
    if (!macAddress) {
      showNotice.error(t('gateway.page.deviceNeedsMac'))
      return
    }
    if (fixedIp && !isDownstreamSource(fixedIp, dhcpRouter, subnetMask)) {
      showNotice.error(t('gateway.page.fixedIpSubnetError'))
      return
    }
    if (
      fixedIp &&
      deviceProfiles.some(
        (profile) =>
          profile.mac_address.toUpperCase() !== macAddress &&
          profile.fixed_ip === fixedIp,
      )
    ) {
      showNotice.error(t('gateway.page.fixedIpDuplicateError'))
      return
    }
    const ports = (editingDevice.blocked_ports_text ?? '')
      .split(/[\s,;/]+/)
      .filter(Boolean)
      .map(Number)
    if (
      ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      showNotice.error(t('gateway.page.invalidPorts'))
      return
    }
    const domains = (editingDevice.blocked_domains ?? [])
      .map((domain) =>
        domain.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, ''),
      )
      .filter(Boolean)
    if (
      domains.some(
        (domain) =>
          domain.includes(',') || domain.includes('/') || domain.includes(' '),
      )
    ) {
      showNotice.error(t('gateway.page.invalidDomains'))
      return
    }
    const nextDevices = deviceProfiles.filter(
      (profile) => profile.mac_address.toUpperCase() !== macAddress,
    )
    const { blocked_ports_text: _blockedPortsText, ...profileToSave } =
      editingDevice
    nextDevices.push({
      ...profileToSave,
      mac_address: macAddress,
      name: editingDevice.name.trim(),
      fixed_ip: fixedIp,
      owner: editingDevice.owner?.trim() ?? '',
      group: editingDevice.group || 'unknown',
      notes: editingDevice.notes?.trim() ?? '',
      blocked_domains: [...new Set(domains)],
      blocked_ports: [...new Set(ports)].sort((left, right) => left - right),
    })
    try {
      await patchVerge({
        gateway_mode: { ...saved, devices: nextDevices },
      })
      if (dhcpStatus?.running) {
        await stopDhcpServer()
        const next = await startDhcpServer({
          interface: effectiveLanInterface,
          serverAddress: dhcpRouter,
          poolStart,
          poolEnd,
          subnetMask,
          router: dhcpRouter,
          dns: dhcpDns,
          leaseTimeSecs: Math.round(leaseHours * 3600),
          reservations: reservationsFor(nextDevices),
        })
        setDhcpStatus(next)
      }
      setEditingDevice(null)
      showNotice.success(t('gateway.page.deviceSaved'))
      if (fixedIp) showNotice.info(t('gateway.page.reconnectForFixedIp'))
    } catch (error) {
      showNotice.error(error)
      setDhcpStatus(await getDhcpServerStatus().catch(() => dhcpStatus))
    }
  })

  const toggleDhcp = useLockFn(async () => {
    if (!effectiveLanInterface || !dhcpRouter) {
      showNotice.error(t('gateway.page.selectInterfaceError'))
      return
    }
    try {
      if (dhcpStatus?.running) {
        setDhcpStatus(await stopDhcpServer())
        setDhcpEnabled(false)
      } else {
        const next = await startDhcpServer({
          interface: effectiveLanInterface,
          serverAddress: dhcpRouter,
          poolStart,
          poolEnd,
          subnetMask,
          router: dhcpRouter,
          dns: dhcpDns,
          leaseTimeSecs: Math.round(leaseHours * 3600),
          reservations: reservationsFor(deviceProfiles),
        })
        setDhcpStatus(next)
        setDhcpEnabled(true)
      }
      await patchVerge({
        gateway_mode: {
          ...(saved ?? {
            enabled: false,
            lan_interface: effectiveLanInterface,
            gateway_address: gatewayAddress,
            dns_address: dnsAddress,
            hijack_dns: hijackDns,
            tun_was_enabled: false,
            forwarding_was_enabled: false,
            device_policies: [],
            devices: [],
            dhcp: {
              enabled: false,
              pool_start: poolStart,
              pool_end: poolEnd,
              subnet_mask: subnetMask,
              router: dhcpRouter,
              dns: dhcpDns,
              lease_time_secs: Math.round(leaseHours * 3600),
            },
          }),
          dhcp: {
            enabled: !dhcpStatus?.running,
            pool_start: poolStart,
            pool_end: poolEnd,
            subnet_mask: subnetMask,
            router: dhcpRouter,
            dns: dhcpDns,
            lease_time_secs: Math.round(leaseHours * 3600),
          },
        },
      })
    } catch (error) {
      showNotice.error(error)
      setDhcpStatus(await getDhcpServerStatus().catch(() => dhcpStatus))
    }
  })

  const toggleGateway = useLockFn(async () => {
    if (!effectiveLanInterface || !gatewayAddress) {
      showNotice.error('Please select a LAN interface with an IPv4 address')
      return
    }

    const nextEnabled = !enabled
    try {
      if (nextEnabled) {
        // TUN needs the privileged service on macOS.  The normal TUN switch
        // takes care of this, but Gateway used to bypass that path and could
        // leave DHCP running while Mihomo stayed unprivileged/TUN-disabled.
        if (!(await isServiceAvailable())) {
          showNotice.info('正在安装网关所需的系统服务…')
          await installService()
          await restartCore()
          if (!(await isServiceAvailable())) {
            throw new Error('系统服务未就绪，无法启动网关 TUN')
          }
        }
        const forwardingWasEnabled = status?.forwardingEnabled ?? false
        await patchClash({
          'allow-lan': true,
          tun: {
            stack: clash?.tun?.stack ?? 'gvisor',
            device: clash?.tun?.device ?? '',
            'auto-route': true,
            'strict-route': true,
            'auto-detect-interface': true,
            'dns-hijack': hijackDns
              ? ['any:53']
              : (clash?.tun?.['dns-hijack'] ?? []),
            mtu: clash?.tun?.mtu ?? 9000,
          },
        })
        const nextStatus = await setGatewayForwarding(
          true,
          effectiveLanInterface,
        )
        setStatus(nextStatus)
        await patchVerge({
          enable_tun_mode: true,
          gateway_mode: {
            enabled: true,
            lan_interface: effectiveLanInterface,
            gateway_address: gatewayAddress,
            dns_address: dnsAddress,
            hijack_dns: hijackDns,
            tun_was_enabled: verge?.enable_tun_mode ?? false,
            forwarding_was_enabled: forwardingWasEnabled,
            device_policies: saved?.device_policies ?? [],
            devices: saved?.devices ?? [],
            dhcp: saved?.dhcp ?? {
              enabled: false,
              pool_start: poolStart,
              pool_end: poolEnd,
              subnet_mask: subnetMask,
              router: dhcpRouter,
              dns: dhcpDns,
              lease_time_secs: Math.round(leaseHours * 3600),
            },
          },
        })
      } else {
        if (dhcpStatus?.running) {
          setDhcpStatus(await stopDhcpServer())
          setDhcpEnabled(false)
        }
        if (!saved?.forwarding_was_enabled) {
          setStatus(await setGatewayForwarding(false, effectiveLanInterface))
        }
        if (!saved?.tun_was_enabled) {
          await patchVerge({ enable_tun_mode: false })
        }
        await patchVerge({
          enable_tun_mode: saved?.tun_was_enabled ?? false,
          gateway_mode: {
            ...(saved ?? {
              enabled: false,
              lan_interface: effectiveLanInterface,
              gateway_address: gatewayAddress,
              dns_address: dnsAddress,
              hijack_dns: hijackDns,
              tun_was_enabled: false,
              forwarding_was_enabled: false,
              device_policies: [],
              devices: [],
              dhcp: {
                enabled: false,
                pool_start: poolStart,
                pool_end: poolEnd,
                subnet_mask: subnetMask,
                router: dhcpRouter,
                dns: dhcpDns,
                lease_time_secs: Math.round(leaseHours * 3600),
              },
            }),
            enabled: false,
            lan_interface: effectiveLanInterface,
            gateway_address: gatewayAddress,
            dns_address: dnsAddress,
            hijack_dns: hijackDns,
            dhcp: {
              ...(saved?.dhcp ?? {
                pool_start: poolStart,
                pool_end: poolEnd,
                subnet_mask: subnetMask,
                router: dhcpRouter,
                dns: dhcpDns,
                lease_time_secs: Math.round(leaseHours * 3600),
              }),
              enabled: false,
            },
          },
        })
      }
    } catch (error) {
      showNotice.error(error)
      setStatus(await getGatewayStatus().catch(() => status))
    }
  })

  return (
    <BasePage title={t('gateway.page.title')}>
      <Stack spacing={2}>
        <Alert severity="info">{t('gateway.page.description')}</Alert>
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <RouterOutlinedIcon />
                <Typography variant="h6">{t('gateway.page.status')}</Typography>
                <Chip
                  color={
                    enabled && status?.forwardingEnabled ? 'success' : 'default'
                  }
                  label={
                    enabled && status?.forwardingEnabled
                      ? t('gateway.page.enabled')
                      : t('gateway.page.disabled')
                  }
                  size="small"
                />
              </Stack>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 2,
                }}
              >
                <Box>
                  <Typography variant="caption">
                    {t('gateway.page.interface')}
                  </Typography>
                  <Select
                    fullWidth
                    size="small"
                    value={effectiveLanInterface}
                    disabled={enabled}
                    onChange={(event) => setLanInterface(event.target.value)}
                  >
                    {networkInterfaces.map((item) => (
                      <MenuItem key={item.name} value={item.name}>
                        {item.name} {ipv4Of(item) ? `(${ipv4Of(item)})` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </Box>
                <TextField
                  size="small"
                  label={t('gateway.page.gatewayAddress')}
                  value={gatewayAddress}
                  disabled
                />
                <TextField
                  size="small"
                  label={t('gateway.page.dnsAddress')}
                  value={dnsAddress}
                  disabled={enabled}
                  onChange={(event) => setDnsAddress(event.target.value)}
                />
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={hijackDns}
                    disabled={enabled}
                    onChange={(_, checked) => setHijackDns(checked)}
                  />
                }
                label={t('gateway.page.hijackDns')}
              />
              <Button
                variant="contained"
                color={enabled ? 'error' : 'primary'}
                disabled={!status?.supported}
                onClick={toggleGateway}
              >
                {enabled ? t('gateway.page.stop') : t('gateway.page.start')}
              </Button>
              <Typography variant="body2" color="text.secondary">
                {t('gateway.page.clientHelp')}
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Stack spacing={2}>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box>
                  <Typography variant="h6">
                    {t('gateway.page.dhcpServer')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('gateway.page.dhcpDescription')}
                  </Typography>
                </Box>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Chip
                    size="small"
                    color={dhcpStatus?.running ? 'success' : 'default'}
                    label={
                      dhcpStatus?.running
                        ? t('gateway.page.running')
                        : t('gateway.page.stopped')
                    }
                  />
                  <Switch
                    checked={dhcpStatus?.running ?? dhcpEnabled}
                    disabled={!enabled}
                    onChange={() => void toggleDhcp()}
                  />
                </Stack>
              </Stack>
              <Alert severity="warning">{t('gateway.page.dhcpWarning')}</Alert>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 1.5,
                }}
              >
                <TextField
                  size="small"
                  label={t('gateway.page.poolStart')}
                  value={poolStart}
                  disabled={dhcpStatus?.running}
                  onChange={(event) => setPoolStart(event.target.value)}
                />
                <TextField
                  size="small"
                  label={t('gateway.page.poolEnd')}
                  value={poolEnd}
                  disabled={dhcpStatus?.running}
                  onChange={(event) => setPoolEnd(event.target.value)}
                />
                <TextField
                  size="small"
                  label={t('gateway.page.subnetMask')}
                  value={subnetMask}
                  disabled={dhcpStatus?.running}
                  onChange={(event) => setSubnetMask(event.target.value)}
                />
                <TextField
                  size="small"
                  label={t('gateway.page.router')}
                  value={dhcpRouter}
                  disabled={dhcpStatus?.running}
                  onChange={(event) => setDhcpRouter(event.target.value)}
                />
                <TextField
                  size="small"
                  label={t('gateway.page.dhcpDns')}
                  value={dhcpDns}
                  disabled={dhcpStatus?.running}
                  onChange={(event) => setDhcpDns(event.target.value)}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t('gateway.page.leaseHours')}
                  value={leaseHours}
                  disabled={dhcpStatus?.running}
                  slotProps={{ htmlInput: { min: 1, max: 168 } }}
                  onChange={(event) =>
                    setLeaseHours(Number(event.target.value))
                  }
                />
              </Box>
              {dhcpStatus?.error && (
                <Alert severity="error">{dhcpStatus.error}</Alert>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <Tabs
            value={panel}
            onChange={(_, value) => setPanel(value)}
            variant="scrollable"
          >
            <Tab
              value="devices"
              label={`${t('gateway.page.devices')} (${knownDevices.length})`}
            />
            <Tab
              value="connections"
              label={`${t('gateway.page.activeConnections')} (${visibleConnections.length})`}
            />
            <Tab value="traffic" label={t('gateway.page.trafficStatistics')} />
          </Tabs>
          <CardContent sx={{ pt: 1 }}>
            {panel === 'devices' && (
              <>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}
                >
                  <Chip
                    color="success"
                    label={`${t('gateway.page.onlineDevices')}: ${
                      knownDevices.filter(([, item]) => item.online).length
                    }`}
                  />
                  <Chip
                    color="warning"
                    label={`${t('gateway.page.untrustedDevices')}: ${
                      knownDevices.filter(([, item]) => {
                        const profile = deviceProfiles.find(
                          (candidate) =>
                            candidate.mac_address.toUpperCase() ===
                            item.macAddress.toUpperCase(),
                        )
                        return !profile?.trusted
                      }).length
                    }`}
                  />
                  <Chip
                    color="error"
                    label={`${t('gateway.page.blockedDevices')}: ${
                      deviceProfiles.filter(
                        (profile) => profile.internet_blocked,
                      ).length
                    }`}
                  />
                </Stack>
                <TextField
                  fullWidth
                  size="small"
                  sx={{ mb: 1.5 }}
                  label={t('gateway.page.searchDevices')}
                  value={deviceSearch}
                  onChange={(event) => setDeviceSearch(event.target.value)}
                />
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('gateway.page.device')}</TableCell>
                      <TableCell>{t('gateway.page.macAddress')}</TableCell>
                      <TableCell>{t('gateway.page.policy')}</TableCell>
                      <TableCell align="right">
                        {t('gateway.page.connections')}
                      </TableCell>
                      <TableCell align="right">
                        {t('gateway.page.upload')}
                      </TableCell>
                      <TableCell align="right">
                        {t('gateway.page.download')}
                      </TableCell>
                      <TableCell align="right">
                        {t('gateway.page.totalTraffic')}
                      </TableCell>
                      <TableCell align="right">
                        {t('gateway.page.manage')}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleDevices.map(([sourceIP, item]) => (
                      <TableRow
                        key={sourceIP}
                        hover
                        selected={selectedDevice === sourceIP}
                        sx={{ cursor: 'pointer' }}
                        onClick={() => {
                          setSelectedDevice(sourceIP)
                          setPanel('connections')
                        }}
                      >
                        <TableCell>
                          <Stack>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center' }}
                            >
                              <Typography
                                sx={{ fontSize: '1.35rem', lineHeight: 1 }}
                              >
                                {item.icon}
                              </Typography>
                              <Chip
                                size="small"
                                color={item.online ? 'success' : 'default'}
                                label={
                                  item.online
                                    ? t('gateway.page.online')
                                    : t('gateway.page.offline')
                                }
                              />
                              <Typography variant="body2">
                                {item.hostname}
                              </Typography>
                              {deviceProfiles.find(
                                (profile) =>
                                  profile.mac_address.toUpperCase() ===
                                  item.macAddress.toUpperCase(),
                              )?.trusted && (
                                <Chip
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                  label={t('gateway.page.trusted')}
                                />
                              )}
                            </Stack>
                            <Stack direction="row" spacing={1}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {sourceIP}
                              </Typography>
                              {item.fixedIp && (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label={t('gateway.page.fixedIp')}
                                />
                              )}
                              {(() => {
                                const profile = deviceProfiles.find(
                                  (candidate) =>
                                    candidate.mac_address.toUpperCase() ===
                                    item.macAddress.toUpperCase(),
                                )
                                return profile?.group ? (
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={t(deviceGroupLabel(profile.group))}
                                  />
                                ) : null
                              })()}
                            </Stack>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack>
                            <Typography variant="body2">
                              {item.macAddress || '—'}
                            </Typography>
                            {item.lastSeen > 0 && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {t('gateway.page.lastSeen')}:{' '}
                                {new Date(
                                  item.lastSeen * 1000,
                                ).toLocaleString()}
                              </Typography>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Select
                            size="small"
                            onClick={(event) => event.stopPropagation()}
                            value={
                              saved?.device_policies.find(
                                (policy) => policy.source_ip === sourceIP,
                              )?.policy ?? ''
                            }
                            onChange={(event) =>
                              updateDevicePolicy(sourceIP, event.target.value)
                            }
                          >
                            <MenuItem value="">
                              {t('gateway.page.followRules')}
                            </MenuItem>
                            <MenuItem value="DIRECT">DIRECT</MenuItem>
                            <MenuItem value="REJECT">REJECT</MenuItem>
                            {(clash?.['proxy-groups'] ?? []).map((group) => (
                              <MenuItem key={group.name} value={group.name}>
                                {group.name}
                              </MenuItem>
                            ))}
                          </Select>
                        </TableCell>
                        <TableCell align="right">{item.connections}</TableCell>
                        <TableCell align="right">
                          {formatRate(item.upload)}
                        </TableCell>
                        <TableCell align="right">
                          {formatRate(item.download)}
                        </TableCell>
                        <TableCell align="right">
                          {formatTotal(item.uploadTotal + item.downloadTotal)}
                        </TableCell>
                        <TableCell align="right">
                          <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ justifyContent: 'flex-end' }}
                          >
                            <Button
                              size="small"
                              color={
                                deviceProfiles.find(
                                  (profile) =>
                                    profile.mac_address.toUpperCase() ===
                                    item.macAddress.toUpperCase(),
                                )?.internet_blocked
                                  ? 'success'
                                  : 'error'
                              }
                              disabled={!item.macAddress}
                              onClick={(event) => {
                                event.stopPropagation()
                                const blocked =
                                  deviceProfiles.find(
                                    (profile) =>
                                      profile.mac_address.toUpperCase() ===
                                      item.macAddress.toUpperCase(),
                                  )?.internet_blocked ?? false
                                updateDeviceInternet(
                                  item.macAddress,
                                  sourceIP,
                                  item.hostname,
                                  item.icon,
                                  !blocked,
                                )
                              }}
                            >
                              {deviceProfiles.find(
                                (profile) =>
                                  profile.mac_address.toUpperCase() ===
                                  item.macAddress.toUpperCase(),
                              )?.internet_blocked
                                ? t('gateway.page.resumeInternet')
                                : t('gateway.page.pauseInternet')}
                            </Button>
                            <IconButton
                              size="small"
                              disabled={!item.macAddress}
                              onClick={(event) => {
                                event.stopPropagation()
                                const profile = deviceProfiles.find(
                                  (candidate) =>
                                    candidate.mac_address.toUpperCase() ===
                                    item.macAddress.toUpperCase(),
                                )
                                setEditingDevice(
                                  profile
                                    ? {
                                        ...profile,
                                        last_ip: sourceIP,
                                        last_seen: item.lastSeen,
                                        blocked_ports_text: (
                                          profile.blocked_ports ?? []
                                        ).join(', '),
                                      }
                                    : {
                                        mac_address: item.macAddress,
                                        name:
                                          item.hostname === sourceIP
                                            ? ''
                                            : item.hostname,
                                        icon: item.icon,
                                        fixed_ip: '',
                                        last_ip: sourceIP,
                                        last_seen: item.lastSeen,
                                        owner: '',
                                        group: 'unknown',
                                        notes: '',
                                        trusted: false,
                                        internet_blocked: false,
                                        blocked_domains: [],
                                        blocked_ports: [],
                                        blocked_ports_text: '',
                                      },
                                )
                              }}
                            >
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleDevices.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} align="center">
                          {t('gateway.page.empty')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </>
            )}

            {panel === 'connections' && (
              <>
                {selectedDevice && (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ mb: 1, alignItems: 'center' }}
                  >
                    <Typography variant="body2">
                      {t('gateway.page.deviceFilter')}:
                    </Typography>
                    <Chip
                      label={selectedDevice}
                      onDelete={() => setSelectedDevice('')}
                    />
                  </Stack>
                )}
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('gateway.page.source')}</TableCell>
                      <TableCell>{t('gateway.page.destination')}</TableCell>
                      <TableCell>{t('gateway.page.rule')}</TableCell>
                      <TableCell>{t('gateway.page.proxy')}</TableCell>
                      <TableCell>{t('gateway.page.protocol')}</TableCell>
                      <TableCell align="right">
                        {t('gateway.page.upload')}
                      </TableCell>
                      <TableCell align="right">
                        {t('gateway.page.download')}
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleConnections.map((connection) => (
                      <TableRow key={connection.id}>
                        <TableCell>
                          {connection.metadata.sourceIP}:
                          {connection.metadata.sourcePort}
                        </TableCell>
                        <TableCell>
                          {connection.metadata.host ||
                            connection.metadata.destinationIP}
                          :{connection.metadata.destinationPort}
                        </TableCell>
                        <TableCell>
                          {connection.rule}
                          {connection.rulePayload
                            ? ` / ${connection.rulePayload}`
                            : ''}
                        </TableCell>
                        <TableCell>
                          {connection.chains.join(' → ') || 'DIRECT'}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={connection.metadata.network.toUpperCase()}
                          />
                        </TableCell>
                        <TableCell align="right">
                          {formatTotal(connection.upload)}
                        </TableCell>
                        <TableCell align="right">
                          {formatTotal(connection.download)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {visibleConnections.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center">
                          {t('gateway.page.noConnections')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </>
            )}

            {panel === 'traffic' && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 2,
                }}
              >
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="text.secondary">
                      {t('gateway.page.totalDevices')}
                    </Typography>
                    <Typography variant="h4">{knownDevices.length}</Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="text.secondary">
                      {t('gateway.page.activeConnections')}
                    </Typography>
                    <Typography variant="h4">
                      {downstreamConnections.length}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="text.secondary">
                      {t('gateway.page.upload')}
                    </Typography>
                    <Typography variant="h4">
                      {formatRate(
                        knownDevices.reduce(
                          (sum, [, item]) => sum + item.upload,
                          0,
                        ),
                      )}
                    </Typography>
                  </CardContent>
                </Card>
                <Card variant="outlined">
                  <CardContent>
                    <Typography color="text.secondary">
                      {t('gateway.page.download')}
                    </Typography>
                    <Typography variant="h4">
                      {formatRate(
                        knownDevices.reduce(
                          (sum, [, item]) => sum + item.download,
                          0,
                        ),
                      )}
                    </Typography>
                  </CardContent>
                </Card>
              </Box>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={Boolean(editingDevice)}
          onClose={() => setEditingDevice(null)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>{t('gateway.page.editDevice')}</DialogTitle>
          <DialogContent>
            {editingDevice && (
              <Stack spacing={2} sx={{ pt: 1 }}>
                <TextField
                  label={t('gateway.page.customName')}
                  value={editingDevice.name}
                  slotProps={{ htmlInput: { maxLength: 64 } }}
                  onChange={(event) =>
                    setEditingDevice({
                      ...editingDevice,
                      name: event.target.value,
                    })
                  }
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    fullWidth
                    label={t('gateway.page.owner')}
                    value={editingDevice.owner ?? ''}
                    onChange={(event) =>
                      setEditingDevice({
                        ...editingDevice,
                        owner: event.target.value,
                      })
                    }
                  />
                  <TextField
                    fullWidth
                    select
                    label={t('gateway.page.deviceGroup')}
                    value={editingDevice.group ?? 'unknown'}
                    onChange={(event) =>
                      setEditingDevice({
                        ...editingDevice,
                        group: event.target.value,
                      })
                    }
                  >
                    {DEVICE_GROUPS.map((group) => (
                      <MenuItem key={group} value={group}>
                        {t(deviceGroupLabel(group))}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={editingDevice.trusted ?? false}
                        onChange={(event) =>
                          setEditingDevice({
                            ...editingDevice,
                            trusted: event.target.checked,
                          })
                        }
                      />
                    }
                    label={t('gateway.page.trustedDevice')}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        color="error"
                        checked={editingDevice.internet_blocked ?? false}
                        onChange={(event) =>
                          setEditingDevice({
                            ...editingDevice,
                            internet_blocked: event.target.checked,
                          })
                        }
                      />
                    }
                    label={t('gateway.page.blockInternet')}
                  />
                </Stack>
                <Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    {t('gateway.page.deviceIcon')}
                  </Typography>
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    {DEVICE_ICONS.map((icon) => (
                      <Button
                        key={icon}
                        variant={
                          editingDevice.icon === icon ? 'contained' : 'outlined'
                        }
                        sx={{ minWidth: 44, fontSize: '1.35rem' }}
                        onClick={() =>
                          setEditingDevice({ ...editingDevice, icon })
                        }
                      >
                        {icon}
                      </Button>
                    ))}
                  </Stack>
                </Box>
                <TextField
                  label={t('gateway.page.fixedIpAddress')}
                  placeholder={t('gateway.page.fixedIpPlaceholder')}
                  value={editingDevice.fixed_ip}
                  onChange={(event) =>
                    setEditingDevice({
                      ...editingDevice,
                      fixed_ip: event.target.value,
                    })
                  }
                  helperText={t('gateway.page.fixedIpHelp')}
                />
                <TextField
                  multiline
                  minRows={3}
                  label={t('gateway.page.blockedDomains')}
                  placeholder={t('gateway.page.blockedDomainsPlaceholder')}
                  value={(editingDevice.blocked_domains ?? []).join('\n')}
                  onChange={(event) =>
                    setEditingDevice({
                      ...editingDevice,
                      blocked_domains: event.target.value.split('\n'),
                    })
                  }
                  helperText={t('gateway.page.blockedDomainsHelp')}
                />
                <TextField
                  label={t('gateway.page.blockedPorts')}
                  placeholder="25, 135, 139, 445"
                  value={editingDevice.blocked_ports_text ?? ''}
                  onChange={(event) =>
                    setEditingDevice({
                      ...editingDevice,
                      blocked_ports_text: event.target.value,
                    })
                  }
                  helperText={t('gateway.page.blockedPortsHelp')}
                />
                <TextField
                  multiline
                  minRows={2}
                  label={t('gateway.page.deviceNotes')}
                  value={editingDevice.notes ?? ''}
                  onChange={(event) =>
                    setEditingDevice({
                      ...editingDevice,
                      notes: event.target.value,
                    })
                  }
                  helperText={t('gateway.page.deviceNotesHelp')}
                />
                <TextField
                  label={t('gateway.page.macAddress')}
                  value={editingDevice.mac_address}
                  disabled
                />
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditingDevice(null)}>
              {t('gateway.page.cancel')}
            </Button>
            <Button variant="contained" onClick={saveDevice}>
              {t('gateway.page.save')}
            </Button>
          </DialogActions>
        </Dialog>
      </Stack>
    </BasePage>
  )
}

export default GatewayPage
