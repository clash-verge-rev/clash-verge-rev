import { RestartAltRounded, Shuffle } from '@mui/icons-material'
import {
  CircularProgress,
  IconButton,
  List,
  ListItem,
  Stack,
  TextField,
} from '@mui/material'
import { useLockFn, useRequest } from 'ahooks'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, Switch } from '@/components/base'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useDefaultVergeConfig, useVerge } from '@/hooks/use-verge'
import { saveProxyPorts } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import getSystem from '@/utils/get-system'

import SettingListItemText from './setting-list-item-text-comp'

const OS = getSystem()

interface ClashPortViewerRef {
  open: () => void
  close: () => void
}

const generateRandomPort = () =>
  Math.floor(Math.random() * (65535 - 1025 + 1)) + 1025

export const ClashPortViewer = forwardRef<ClashPortViewerRef>((_, ref) => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const {
    verge_mixed_port: defaultVergeMixedPort,
    verge_socks_port: defaultVergeSocksPort,
    verge_socks_enabled: defaultVergeSocksEnabled,
    verge_port: defaultVergeHttpPort,
    verge_http_enabled: defaultVergeHttpEnabled,
    verge_redir_port: defaultVergeRedirPort,
    verge_redir_enabled: defaultVergeRedirEnabled,
    verge_tproxy_port: defaultVergeTproxyPort,
    verge_tproxy_enabled: defaultVergeTproxyEnabled,
  } = useDefaultVergeConfig() ?? {}
  const displayedMixedPort = useDisplayedMixedPort()
  const [open, setOpen] = useState(false)

  // Mixed Port
  const [mixedPort, setMixedPort] = useState(displayedMixedPort)

  // 其他端口状态
  const [socksPort, setSocksPort] = useState(verge?.verge_socks_port ?? 7898)
  const [socksEnabled, setSocksEnabled] = useState(
    verge?.verge_socks_enabled ?? false,
  )
  const [httpPort, setHttpPort] = useState(verge?.verge_port ?? 7899)
  const [httpEnabled, setHttpEnabled] = useState(
    verge?.verge_http_enabled ?? false,
  )
  const [redirPort, setRedirPort] = useState(verge?.verge_redir_port ?? 7895)
  const [redirEnabled, setRedirEnabled] = useState(
    verge?.verge_redir_enabled ?? false,
  )
  const [tproxyPort, setTproxyPort] = useState(verge?.verge_tproxy_port ?? 7896)
  const [tproxyEnabled, setTproxyEnabled] = useState(
    verge?.verge_tproxy_enabled ?? false,
  )

  // 添加保存请求，防止GUI卡死
  const { loading, runAsync: saveSettings } = useRequest(saveProxyPorts, {
    manual: true,
    onSuccess: (outcome) => {
      if (outcome.status === 'conflict') {
        showNotice.error('settings.modals.clashPort.messages.portInUse', {
          port: outcome.port,
        })
        return
      }
      setOpen(false)
      showNotice.success('settings.modals.clashPort.messages.saved')
    },
    onError: (error) => {
      showNotice.error('settings.modals.clashPort.messages.saveFailed', error)
    },
  })

  useImperativeHandle(ref, () => ({
    open: () => {
      setMixedPort(displayedMixedPort)
      setSocksPort(verge?.verge_socks_port ?? 7898)
      setSocksEnabled(verge?.verge_socks_enabled ?? false)
      setHttpPort(verge?.verge_port ?? 7899)
      setHttpEnabled(verge?.verge_http_enabled ?? false)
      setRedirPort(verge?.verge_redir_port ?? 7895)
      setRedirEnabled(verge?.verge_redir_enabled ?? false)
      setTproxyPort(verge?.verge_tproxy_port ?? 7896)
      setTproxyEnabled(verge?.verge_tproxy_enabled ?? false)
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  // TODO 减少代码复杂度，性能开支
  const onSave = useLockFn(async () => {
    // 端口冲突检测
    const portList = [
      mixedPort,
      socksEnabled ? socksPort : -1,
      httpEnabled ? httpPort : -1,
      redirEnabled ? redirPort : -1,
      tproxyEnabled ? tproxyPort : -1,
    ].filter((p) => p !== -1)

    if (new Set(portList).size !== portList.length) {
      return
    }

    // 验证端口范围
    const isValidPort = (port: number) => port >= 1 && port <= 65535
    const allPortsValid = [
      mixedPort,
      socksEnabled ? socksPort : 0,
      httpEnabled ? httpPort : 0,
      redirEnabled ? redirPort : 0,
      tproxyEnabled ? tproxyPort : 0,
    ].every((port) => port === 0 || isValidPort(port))

    if (!allPortsValid) {
      return
    }

    await saveSettings({
      mixedPort,
      socks: { enabled: socksEnabled, port: socksPort },
      http: { enabled: httpEnabled, port: httpPort },
      redir: { enabled: redirEnabled, port: redirPort },
      tproxy: { enabled: tproxyEnabled, port: tproxyPort },
    })
  })

  return (
    <BaseDialog
      open={open}
      title={t('settings.modals.clashPort.title')}
      contentSx={{
        width: 400,
      }}
      okBtn={
        loading ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} />
            {t('shared.statuses.saving')}
          </Stack>
        ) : (
          t('shared.actions.save')
        )
      }
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List sx={{ width: '100%' }}>
        <ListItem sx={{ padding: '4px 0', minHeight: 36 }}>
          <SettingListItemText
            label={t('settings.modals.clashPort.fields.mixed')}
            modified={mixedPort !== defaultVergeMixedPort}
            slotProps={{ primary: { sx: { fontSize: 12 } } }}
          />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <IconButton
              size="small"
              onClick={() => setMixedPort(generateRandomPort())}
              title={t('settings.modals.clashPort.actions.random')}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() =>
                defaultVergeMixedPort && setMixedPort(defaultVergeMixedPort)
              }
              title={t('shared.actions.resetToDefault')}
              sx={{ mr: 0.5 }}
            >
              <RestartAltRounded fontSize="small" />
            </IconButton>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={mixedPort}
              onChange={(e) =>
                setMixedPort(+e.target.value?.replace(/\D+/, '').slice(0, 5))
              }
              slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
            />
            <Switch
              size="small"
              checked={true}
              disabled={true}
              sx={{ ml: 0.5, opacity: 0.7 }}
            />
          </div>
        </ListItem>

        <ListItem sx={{ padding: '4px 0', minHeight: 36 }}>
          <SettingListItemText
            label={t('settings.modals.clashPort.fields.socks')}
            modified={
              socksEnabled !== defaultVergeSocksEnabled ||
              (socksEnabled && socksPort !== defaultVergeSocksPort)
            }
            slotProps={{ primary: { sx: { fontSize: 12 } } }}
          />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <IconButton
              size="small"
              onClick={() => setSocksPort(generateRandomPort())}
              title={t('settings.modals.clashPort.actions.random')}
              disabled={!socksEnabled}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() =>
                defaultVergeSocksPort && setSocksPort(defaultVergeSocksPort)
              }
              title={t('shared.actions.resetToDefault')}
              sx={{ mr: 0.5 }}
              disabled={!socksEnabled}
            >
              <RestartAltRounded fontSize="small" />
            </IconButton>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={socksPort}
              onChange={(e) =>
                setSocksPort(+e.target.value?.replace(/\D+/, '').slice(0, 5))
              }
              disabled={!socksEnabled}
              slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
            />
            <Switch
              size="small"
              checked={socksEnabled}
              onChange={(_, c) => setSocksEnabled(c)}
              sx={{ ml: 0.5 }}
            />
          </div>
        </ListItem>

        <ListItem sx={{ padding: '4px 0', minHeight: 36 }}>
          <SettingListItemText
            label={t('settings.modals.clashPort.fields.http')}
            modified={
              httpEnabled !== defaultVergeHttpEnabled ||
              (httpEnabled && httpPort !== defaultVergeHttpPort)
            }
            slotProps={{ primary: { sx: { fontSize: 12 } } }}
          />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <IconButton
              size="small"
              onClick={() => setHttpPort(generateRandomPort())}
              title={t('settings.modals.clashPort.actions.random')}
              disabled={!httpEnabled}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() =>
                defaultVergeHttpPort && setHttpPort(defaultVergeHttpPort)
              }
              title={t('shared.actions.resetToDefault')}
              sx={{ mr: 0.5 }}
              disabled={!httpEnabled}
            >
              <RestartAltRounded fontSize="small" />
            </IconButton>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={httpPort}
              onChange={(e) =>
                setHttpPort(+e.target.value?.replace(/\D+/, '').slice(0, 5))
              }
              disabled={!httpEnabled}
              slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
            />
            <Switch
              size="small"
              checked={httpEnabled}
              onChange={(_, c) => setHttpEnabled(c)}
              sx={{ ml: 0.5 }}
            />
          </div>
        </ListItem>

        {OS !== 'windows' && (
          <ListItem sx={{ padding: '4px 0', minHeight: 36 }}>
            <SettingListItemText
              label={t('settings.modals.clashPort.fields.redir')}
              modified={
                redirEnabled !== defaultVergeRedirEnabled ||
                (redirEnabled && redirPort !== defaultVergeRedirPort)
              }
              slotProps={{ primary: { sx: { fontSize: 12 } } }}
            />
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconButton
                size="small"
                onClick={() => setRedirPort(generateRandomPort())}
                title={t('settings.modals.clashPort.actions.random')}
                disabled={!redirEnabled}
                sx={{ mr: 0.5 }}
              >
                <Shuffle fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() =>
                  defaultVergeRedirPort && setRedirPort(defaultVergeRedirPort)
                }
                title={t('shared.actions.resetToDefault')}
                sx={{ mr: 0.5 }}
                disabled={!redirEnabled}
              >
                <RestartAltRounded fontSize="small" />
              </IconButton>
              <TextField
                size="small"
                sx={{ width: 80, mr: 0.5, fontSize: 12 }}
                value={redirPort}
                onChange={(e) =>
                  setRedirPort(+e.target.value?.replace(/\D+/, '').slice(0, 5))
                }
                disabled={!redirEnabled}
                slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
              />
              <Switch
                size="small"
                checked={redirEnabled}
                onChange={(_, c) => setRedirEnabled(c)}
                sx={{ ml: 0.5 }}
              />
            </div>
          </ListItem>
        )}

        {OS === 'linux' && (
          <ListItem sx={{ padding: '4px 0', minHeight: 36 }}>
            <SettingListItemText
              label={t('settings.modals.clashPort.fields.tproxy')}
              modified={
                tproxyEnabled !== defaultVergeTproxyEnabled ||
                (tproxyEnabled && tproxyPort !== defaultVergeTproxyPort)
              }
              slotProps={{ primary: { sx: { fontSize: 12 } } }}
            />
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconButton
                size="small"
                onClick={() => setTproxyPort(generateRandomPort())}
                title={t('settings.modals.clashPort.actions.random')}
                disabled={!tproxyEnabled}
                sx={{ mr: 0.5 }}
              >
                <Shuffle fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() =>
                  defaultVergeTproxyPort &&
                  setTproxyPort(defaultVergeTproxyPort)
                }
                title={t('shared.actions.resetToDefault')}
                sx={{ mr: 0.5 }}
                disabled={!tproxyEnabled}
              >
                <RestartAltRounded fontSize="small" />
              </IconButton>
              <TextField
                size="small"
                sx={{ width: 80, mr: 0.5, fontSize: 12 }}
                value={tproxyPort}
                onChange={(e) =>
                  setTproxyPort(+e.target.value?.replace(/\D+/, '').slice(0, 5))
                }
                disabled={!tproxyEnabled}
                slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
              />
              <Switch
                size="small"
                checked={tproxyEnabled}
                onChange={(_, c) => setTproxyEnabled(c)}
                sx={{ ml: 0.5 }}
              />
            </div>
          </ListItem>
        )}
      </List>
    </BaseDialog>
  )
})
