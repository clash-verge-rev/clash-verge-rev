import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { confirm } from '@tauri-apps/plugin-dialog'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useCallback, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef, Switch } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import {
  getWslProxyStatus,
  openWebUrl,
  restartWsl,
  setWslProxyEnabled,
  type WslProxyStatus,
  type WslProxySupport,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const WSL_DOCUMENTATION_URL =
  'https://learn.microsoft.com/windows/wsl/networking#mirrored-mode-networking'

export function WslProxyViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<WslProxyStatus | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      setStatus(await getWslProxyStatus())
    } catch (error) {
      setLoadFailed(true)
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
      setStatus(null)
      void refresh()
    },
    close: () => setOpen(false),
  }))

  const supportMessage = (support: WslProxySupport) => {
    switch (support) {
      case 'ready':
        return t('settings.modals.wslProxy.support.ready')
      case 'not_windows':
        return t('settings.modals.wslProxy.support.notWindows')
      case 'not_installed':
        return t('settings.modals.wslProxy.support.notInstalled')
      case 'update_windows':
        return t('settings.modals.wslProxy.support.updateWindows')
      case 'update_wsl':
        return t('settings.modals.wslProxy.support.updateWsl')
      case 'no_distribution':
        return t('settings.modals.wslProxy.support.noDistribution')
      case 'no_wsl2_distribution':
        return t('settings.modals.wslProxy.support.noWsl2Distribution')
      case 'no_user_distribution':
        return t('settings.modals.wslProxy.support.noUserDistribution')
    }
  }

  const onToggle = useLockFn(async (enabled: boolean) => {
    setLoading(true)
    try {
      const nextStatus = await setWslProxyEnabled(enabled)
      setStatus(nextStatus)
      showNotice.success(
        enabled
          ? 'settings.modals.wslProxy.notifications.enabled'
          : 'settings.modals.wslProxy.notifications.disabled',
      )
    } catch (error) {
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  })

  const onRestart = useLockFn(async () => {
    const accepted = await confirm(
      t('settings.modals.wslProxy.messages.restartConfirmation'),
      {
        title: t('settings.modals.wslProxy.actions.restart'),
        kind: 'warning',
      },
    )
    if (!accepted) return

    setLoading(true)
    try {
      await restartWsl()
      showNotice.success('settings.modals.wslProxy.notifications.restarted')
      setStatus(await getWslProxyStatus())
    } catch (error) {
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  })

  const ready = status?.support === 'ready'
  const runningDistributions =
    status?.distributions.filter((distribution) => distribution.running) ?? []

  return (
    <BaseDialog
      open={open}
      title={t('settings.modals.wslProxy.title')}
      contentSx={{ width: 520, maxWidth: 'calc(100vw - 64px)' }}
      disableOk
      cancelBtn={t('shared.actions.close')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <Stack spacing={2} sx={{ pt: 0.5 }}>
        <Alert severity="info">
          {t('settings.modals.wslProxy.messages.scope')}
        </Alert>

        {loading && !status ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        ) : loadFailed ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={refresh}>
                {t('shared.actions.retry')}
              </Button>
            }
          >
            {t('settings.modals.wslProxy.messages.loadFailed')}
          </Alert>
        ) : status ? (
          <>
            <Alert severity={ready ? 'success' : 'warning'}>
              {supportMessage(status.support)}
            </Alert>

            <List dense disablePadding>
              <ListItem disableGutters>
                <ListItemText
                  primary={t(
                    'settings.modals.wslProxy.fields.proxyIntegration',
                  )}
                  secondary={t(
                    'settings.modals.wslProxy.messages.integrationDetail',
                  )}
                />
                <Switch
                  checked={status.integrationEnabled}
                  disabled={loading || (!ready && !status.integrationEnabled)}
                  onChange={(_, enabled) => void onToggle(enabled)}
                />
              </ListItem>

              <ListItem disableGutters>
                <ListItemText
                  primary={t('settings.modals.wslProxy.fields.autoProxy')}
                  secondary={t(
                    'settings.modals.wslProxy.messages.autoProxyDetail',
                  )}
                />
                <Chip
                  size="small"
                  color={status.autoProxyEnabled ? 'warning' : 'success'}
                  label={t(
                    status.autoProxyEnabled
                      ? 'shared.statuses.enabled'
                      : 'shared.statuses.disabled',
                  )}
                />
              </ListItem>

              <ListItem disableGutters>
                <ListItemText
                  primary={t('settings.modals.wslProxy.fields.proxyEndpoint')}
                  secondary={
                    status.proxyPort
                      ? `http://127.0.0.1:${status.proxyPort}`
                      : t('shared.statuses.empty')
                  }
                />
              </ListItem>

              <ListItem disableGutters>
                <ListItemText
                  primary={t('settings.modals.wslProxy.fields.networkingMode')}
                />
                <Typography variant="body2">
                  {status.mirroredNetworking
                    ? t('settings.modals.wslProxy.values.mirrored')
                    : t('settings.modals.wslProxy.values.other')}
                </Typography>
              </ListItem>

              <ListItem disableGutters>
                <ListItemText
                  primary={t('settings.modals.wslProxy.fields.distributions')}
                  secondary={
                    status.distributions.length > 0
                      ? status.distributions
                          .map((distribution) =>
                            t(
                              distribution.manageable
                                ? 'settings.modals.wslProxy.values.distribution'
                                : 'settings.modals.wslProxy.values.internalDistribution',
                              {
                                name: distribution.name,
                                version: distribution.version ?? '?',
                              },
                            ),
                          )
                          .join(', ')
                      : t('shared.statuses.empty')
                  }
                />
              </ListItem>

              <ListItem disableGutters>
                <ListItemText
                  primary={t('settings.modals.wslProxy.fields.compatibility')}
                  secondary={t(
                    'settings.modals.wslProxy.values.compatibility',
                    {
                      version: status.wslVersion ?? '?',
                      build: status.windowsBuild ?? '?',
                    },
                  )}
                />
              </ListItem>
            </List>

            {!status.configurationManaged && (
              <Alert
                severity="warning"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    disabled={loading}
                    onClick={() => void onToggle(false)}
                  >
                    {t('settings.modals.wslProxy.actions.applyOff')}
                  </Button>
                }
              >
                {t('settings.modals.wslProxy.messages.unmanaged')}
              </Alert>
            )}

            {status.configurationManaged && !status.configurationReady && (
              <Alert
                severity="warning"
                action={
                  <Button
                    color="inherit"
                    size="small"
                    disabled={loading || (status.integrationEnabled && !ready)}
                    onClick={() => void onToggle(status.integrationEnabled)}
                  >
                    {t('settings.modals.wslProxy.actions.reapply')}
                  </Button>
                }
              >
                {t('settings.modals.wslProxy.messages.configurationDrift', {
                  configuredPort: status.configuredProxyPort ?? '?',
                  currentPort: status.proxyPort ?? '?',
                })}
              </Alert>
            )}

            {status.integrationEnabled && verge?.enable_tun_mode && (
              <Alert severity="warning">
                {t('settings.modals.wslProxy.messages.tunModeWarning')}
              </Alert>
            )}

            {(status.restartRequired || runningDistributions.length > 0) && (
              <Alert
                severity={status.restartRequired ? 'warning' : 'info'}
                action={
                  <Button
                    color="inherit"
                    size="small"
                    disabled={loading}
                    onClick={() => void onRestart()}
                  >
                    {t('settings.modals.wslProxy.actions.restart')}
                  </Button>
                }
              >
                {status.restartRequired
                  ? t('settings.modals.wslProxy.messages.restartRequired')
                  : t('settings.modals.wslProxy.messages.running', {
                      count: runningDistributions.length,
                    })}
              </Alert>
            )}

            <Button
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() => openWebUrl(WSL_DOCUMENTATION_URL)}
            >
              {t('settings.modals.wslProxy.actions.documentation')}
            </Button>
          </>
        ) : null}
      </Stack>
    </BaseDialog>
  )
}
