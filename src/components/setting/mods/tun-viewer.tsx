import {
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BaseDialog,
  BaseSplitChipEditor,
  TooltipIcon,
  DialogRef,
  Switch,
} from '@/components/base'
import { useClash } from '@/hooks/use-clash'
import { useVerge } from '@/hooks/use-verge'
import { enhanceProfiles, getNetworkInterfacesInfo } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import getSystem from '@/utils/get-system'
import { areValidIpCidrs } from '@/utils/network'

import { StackModeSwitch } from './stack-mode-switch'

const OS = getSystem()

const splitRouteExcludeAddress = (value: string) =>
  value
    .split(/[,\n;\r]+/)
    .map((item) => item.trim())
    .filter(Boolean)

export function TunViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()

  const { clash, mutateClash, patchClash } = useClash()
  const { verge, patchVerge } = useVerge()

  const [open, setOpen] = useState(false)
  const [outboundInterfaceChanged, setOutboundInterfaceChanged] =
    useState(false)
  const [compatibilityGuardChanged, setCompatibilityGuardChanged] =
    useState(false)
  const [networkInterfaces, setNetworkInterfaces] = useState<
    INetworkInterface[] | null
  >(null)
  const [interfacesLoading, setInterfacesLoading] = useState(false)
  const [interfacesError, setInterfacesError] = useState(false)
  const [values, setValues] = useState({
    stack: 'mips',
    device: OS === 'macos' ? 'utun1024' : 'Mihomo',
    autoRoute: true,
    routeExcludeAddress: '',
    autoRedirect: false,
    autoDetectInterface: true,
    lockOutboundInterface: false,
    interfaceName: '',
    tunCompatibilityGuard: false,
    dnsHijack: ['any:53'],
    strictRoute: false,
    mtu: 1500,
  })

  const routeExcludeAddressItems = splitRouteExcludeAddress(
    values.routeExcludeAddress,
  )
  const routeExcludeAddressError =
    values.autoRoute &&
    routeExcludeAddressItems.length > 0 &&
    !areValidIpCidrs(routeExcludeAddressItems)
  const routeExcludeAddressHelperText = routeExcludeAddressError
    ? t('settings.modals.tun.messages.invalidRouteExcludeAddress')
    : t('settings.modals.tun.messages.routeExcludeAddressHint')
  const interfaceNameError =
    values.lockOutboundInterface && values.interfaceName.trim() === ''
  const hasLockedInterface =
    values.lockOutboundInterface && values.interfaceName.trim() !== ''
  const interfaceNameMissing =
    values.interfaceName !== '' &&
    !networkInterfaces?.some((iface) => iface.name === values.interfaceName)
  const interfaceNameNotDetected =
    interfaceNameMissing &&
    networkInterfaces !== null &&
    !interfacesLoading &&
    !interfacesError
  const interfacesStatus = interfacesLoading
    ? t('shared.statuses.loading')
    : interfacesError
      ? t('settings.modals.tun.messages.interfacesLoadFailed')
      : networkInterfaces?.length === 0
        ? t('settings.modals.tun.messages.interfacesEmpty')
        : ''

  const fetchNetworkInterfaces = useLockFn(async () => {
    setInterfacesLoading(true)
    setInterfacesError(false)
    try {
      setNetworkInterfaces(await getNetworkInterfacesInfo())
    } catch {
      setInterfacesError(true)
    } finally {
      setInterfacesLoading(false)
    }
  })

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
      setOutboundInterfaceChanged(false)
      setCompatibilityGuardChanged(false)
      void fetchNetworkInterfaces()
      const nextAutoRoute = clash?.tun['auto-route'] ?? true
      const rawAutoRedirect = clash?.tun['auto-redirect'] ?? false
      const computedAutoRedirect =
        OS === 'linux' ? (nextAutoRoute ? rawAutoRedirect : false) : false
      const interfaceName = clash?.['interface-name'] ?? ''
      const autoDetectInterface = clash?.tun['auto-detect-interface'] ?? true
      setValues({
        stack: clash?.tun.stack ?? 'mips',
        device: clash?.tun.device ?? (OS === 'macos' ? 'utun1024' : 'Mihomo'),
        autoRoute: nextAutoRoute,
        routeExcludeAddress: (clash?.tun['route-exclude-address'] ?? []).join(
          ',',
        ),
        autoRedirect: computedAutoRedirect,
        autoDetectInterface,
        lockOutboundInterface: interfaceName !== '' && !autoDetectInterface,
        interfaceName,
        tunCompatibilityGuard: verge?.enable_tun_compatibility_guard ?? false,
        dnsHijack: clash?.tun['dns-hijack'] ?? ['any:53'],
        strictRoute: clash?.tun['strict-route'] ?? false,
        mtu: clash?.tun.mtu ?? 1500,
      })
    },
    close: () => setOpen(false),
  }))

  const onSave = useLockFn(async () => {
    let settingsApplied = false
    try {
      const routeExcludeAddress = routeExcludeAddressItems

      if (routeExcludeAddressError) {
        showNotice.error(
          'settings.modals.tun.messages.invalidRouteExcludeAddress',
        )
        return
      }

      if (interfaceNameError) {
        showNotice.error('settings.modals.tun.messages.interfaceNameRequired')
        return
      }

      if (
        OS === 'windows' &&
        values.tunCompatibilityGuard &&
        !hasLockedInterface
      ) {
        showNotice.error(
          'settings.modals.tun.messages.tunCompatibilityGuardRequiresInterface',
        )
        return
      }

      const interfaceName = values.lockOutboundInterface
        ? values.interfaceName
        : ''
      const interfacePatch = outboundInterfaceChanged
        ? { 'interface-name': interfaceName }
        : {}
      const tun: IConfigData['tun'] = {
        stack: values.stack,
        device:
          values.device === ''
            ? OS === 'macos'
              ? 'utun1024'
              : 'Mihomo'
            : values.device,
        'auto-route': values.autoRoute,
        'route-exclude-address': routeExcludeAddress,
        ...(OS === 'linux'
          ? {
              'auto-redirect': values.autoRedirect,
            }
          : {}),
        'auto-detect-interface': values.lockOutboundInterface
          ? false
          : values.autoDetectInterface,
        'dns-hijack': values.dnsHijack[0] === '' ? [] : values.dnsHijack,
        'strict-route': values.strictRoute,
        mtu: values.mtu ?? 1500,
      }
      if (
        OS === 'windows' &&
        compatibilityGuardChanged &&
        !values.tunCompatibilityGuard
      ) {
        await patchVerge({ enable_tun_compatibility_guard: false })
        settingsApplied = true
      }
      await patchClash({ tun, ...interfacePatch })
      settingsApplied = true
      await mutateClash(
        (old) => ({
          ...old!,
          tun,
          ...interfacePatch,
        }),
        false,
      )
      if (
        OS === 'windows' &&
        compatibilityGuardChanged &&
        values.tunCompatibilityGuard
      ) {
        await patchVerge({ enable_tun_compatibility_guard: true })
      }
      setOpen(false)
      showNotice.success('settings.modals.tun.messages.applied')
      void enhanceProfiles().catch((err: any) => {
        showNotice.error(err)
      })
    } catch (err: any) {
      if (settingsApplied) {
        showNotice.error('settings.modals.tun.messages.partialSaveFailed', err)
      } else {
        showNotice.error(err)
      }
    }
  })

  return (
    <BaseDialog
      open={open}
      title={
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="h6">{t('settings.modals.tun.title')}</Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={async () => {
              const tun: IConfigData['tun'] = {
                stack: 'mips',
                device: OS === 'macos' ? 'utun1024' : 'Mihomo',
                'auto-route': true,
                ...(OS === 'linux'
                  ? {
                      'auto-redirect': false,
                    }
                  : {}),
                'auto-detect-interface': true,
                'dns-hijack': ['any:53'],
                'route-exclude-address': [],
                'strict-route': false,
                mtu: 1500,
              }
              setValues({
                stack: 'mips',
                device: OS === 'macos' ? 'utun1024' : 'Mihomo',
                autoRoute: true,
                routeExcludeAddress: '',
                autoRedirect: false,
                autoDetectInterface: true,
                lockOutboundInterface: false,
                interfaceName: '',
                tunCompatibilityGuard: false,
                dnsHijack: ['any:53'],
                strictRoute: false,
                mtu: 1500,
              })
              setOutboundInterfaceChanged(true)
              setCompatibilityGuardChanged(true)
              let settingsApplied = false
              try {
                if (OS === 'windows') {
                  await patchVerge({ enable_tun_compatibility_guard: false })
                  settingsApplied = true
                }
                await patchClash({ tun, 'interface-name': '' })
                settingsApplied = true
                await mutateClash(
                  (old) => ({
                    ...old!,
                    tun,
                    'interface-name': '',
                  }),
                  false,
                )
              } catch (err: any) {
                if (settingsApplied) {
                  showNotice.error(
                    'settings.modals.tun.messages.partialSaveFailed',
                    err,
                  )
                } else {
                  showNotice.error(err)
                }
              }
            }}
          >
            {t('shared.actions.resetToDefault')}
          </Button>
        </Box>
      }
      contentSx={{ width: 450 }}
      okBtn={t('shared.actions.save')}
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText primary={t('settings.modals.tun.fields.stack')} />
          <StackModeSwitch
            value={values.stack}
            onChange={(value) => {
              setValues((v) => ({
                ...v,
                stack: value,
              }))
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText primary={t('settings.modals.tun.fields.device')} />
          <TextField
            autoComplete="new-password"
            size="small"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.device}
            placeholder="Mihomo"
            onChange={(e) =>
              setValues((v) => ({ ...v, device: e.target.value }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText primary={t('settings.modals.tun.fields.autoRoute')} />
          <Switch
            edge="end"
            checked={values.autoRoute}
            onChange={(_, c) =>
              setValues((v) => ({
                ...v,
                autoRoute: c,
                autoRedirect: c ? v.autoRedirect : false,
              }))
            }
          />
        </ListItem>

        {OS === 'linux' && (
          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.tun.fields.autoRedirect')}
              sx={{ maxWidth: 'fit-content' }}
            />
            <TooltipIcon
              title={t('settings.modals.tun.tooltips.autoRedirect')}
              sx={{ opacity: values.autoRoute ? 0.7 : 0.3 }}
            />
            <Switch
              edge="end"
              checked={values.autoRedirect}
              onChange={(_, c) =>
                setValues((v) => ({
                  ...v,
                  autoRedirect: v.autoRoute ? c : v.autoRedirect,
                }))
              }
              disabled={!values.autoRoute}
              sx={{ marginLeft: 'auto' }}
            />
          </ListItem>
        )}

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText primary={t('settings.modals.tun.fields.strictRoute')} />
          <Switch
            edge="end"
            checked={values.strictRoute}
            onChange={(_, c) => setValues((v) => ({ ...v, strictRoute: c }))}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText
            primary={t('settings.modals.tun.fields.lockOutboundInterface')}
          />
          <Switch
            edge="end"
            checked={values.lockOutboundInterface}
            onChange={(_, c) => {
              setOutboundInterfaceChanged(true)
              setValues((v) => ({
                ...v,
                lockOutboundInterface: c,
                interfaceName: c ? v.interfaceName : '',
                autoDetectInterface: !c,
              }))
            }}
          />
        </ListItem>

        {values.lockOutboundInterface && (
          <ListItem
            sx={{ padding: '5px 2px', alignItems: 'flex-start', gap: 1 }}
          >
            <TextField
              select
              fullWidth
              size="small"
              label={t('settings.modals.tun.fields.interfaceName')}
              value={values.interfaceName}
              disabled={interfacesLoading}
              error={interfaceNameError}
              helperText={
                <>
                  {interfaceNameError
                    ? t('settings.modals.tun.messages.interfaceNameRequired')
                    : t('settings.modals.tun.messages.interfaceNameHint')}
                  {interfacesStatus && (
                    <Box component="span" sx={{ display: 'block' }}>
                      {interfacesStatus}
                    </Box>
                  )}
                </>
              }
              slotProps={{
                select: {
                  renderValue: () =>
                    interfaceNameNotDetected
                      ? `${values.interfaceName} (${t('settings.modals.tun.messages.interfaceNotDetected')})`
                      : values.interfaceName,
                },
              }}
              onChange={(e) => {
                setOutboundInterfaceChanged(true)
                setValues((v) => ({ ...v, interfaceName: e.target.value }))
              }}
            >
              <MenuItem value="" disabled>
                {t('settings.modals.tun.messages.interfaceNameRequired')}
              </MenuItem>
              {(networkInterfaces ?? []).map((iface) => (
                <MenuItem key={iface.name} value={iface.name}>
                  <ListItemText
                    primary={iface.name}
                    secondary={iface.addr
                      .map((address) => address.V4?.ip ?? address.V6?.ip)
                      .filter(Boolean)
                      .join(', ')}
                  />
                </MenuItem>
              ))}
              {interfaceNameMissing && (
                <MenuItem value={values.interfaceName}>
                  <ListItemText
                    primary={values.interfaceName}
                    secondary={
                      interfaceNameNotDetected
                        ? t('settings.modals.tun.messages.interfaceNotDetected')
                        : undefined
                    }
                  />
                </MenuItem>
              )}
            </TextField>
            <Button
              size="small"
              variant="outlined"
              disabled={interfacesLoading}
              onClick={() => void fetchNetworkInterfaces()}
              sx={{ flexShrink: 0, minHeight: 40 }}
            >
              {t('shared.actions.refresh')}
            </Button>
          </ListItem>
        )}

        {OS === 'windows' && (
          <ListItem sx={{ padding: '5px 2px', gap: 1 }}>
            <ListItemText
              primary={t('settings.modals.tun.fields.tunCompatibilityGuard')}
              secondary={t(
                'settings.modals.tun.messages.tunCompatibilityGuardHint',
              )}
            />
            <Tooltip
              title={t('settings.modals.tun.tooltips.tunCompatibilityGuard')}
              arrow
            >
              <span>
                <Switch
                  edge="end"
                  checked={values.tunCompatibilityGuard}
                  disabled={
                    !values.tunCompatibilityGuard && !hasLockedInterface
                  }
                  onChange={(_, c) => {
                    setCompatibilityGuardChanged(true)
                    if (c) setOutboundInterfaceChanged(true)
                    setValues((v) => ({ ...v, tunCompatibilityGuard: c }))
                  }}
                />
              </span>
            </Tooltip>
          </ListItem>
        )}

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText
            primary={t('settings.modals.tun.fields.autoDetectInterface')}
          />
          <Switch
            edge="end"
            checked={values.autoDetectInterface}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoDetectInterface: c }))
            }
            disabled={values.lockOutboundInterface}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText primary={t('settings.modals.tun.fields.dnsHijack')} />
          <TextField
            autoComplete="new-password"
            size="small"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.dnsHijack.join(',')}
            placeholder={t('settings.modals.tun.tooltips.dnsHijack')}
            onChange={(e) =>
              setValues((v) => ({ ...v, dnsHijack: e.target.value.split(',') }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText primary={t('settings.modals.tun.fields.mtu')} />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.mtu}
            placeholder="1500"
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                mtu: parseInt(e.target.value),
              }))
            }
          />
        </ListItem>

        <BaseSplitChipEditor
          value={values.routeExcludeAddress}
          placeholder="192.168.0.0/16"
          ariaLabel={t('settings.modals.tun.fields.routeExcludeAddress')}
          disabled={!values.autoRoute}
          error={routeExcludeAddressError}
          helperText={routeExcludeAddressHelperText}
          onChange={(nextValue) =>
            setValues((v) => ({ ...v, routeExcludeAddress: nextValue }))
          }
          renderHeader={(modeToggle) => (
            <ListItem sx={{ padding: '5px 2px' }}>
              <ListItemText
                primary={t('settings.modals.tun.fields.routeExcludeAddress')}
              />
              {modeToggle ? (
                <Box sx={{ marginLeft: 'auto' }}>{modeToggle}</Box>
              ) : null}
            </ListItem>
          )}
        />
      </List>
    </BaseDialog>
  )
}
