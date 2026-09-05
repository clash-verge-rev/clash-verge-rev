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
import {
  useCachedVergeConfigField,
  useVergeConfigField,
} from '@/hooks/use-verge'
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
  const displayedMixedPort = useDisplayedMixedPort()
  const [open, setOpen] = useState(false)

  // Mixed Port
  const [mixedPort, setMixedPort] = useState(displayedMixedPort)
  const mixedPortField = useVergeConfigField(
    'verge_mixed_port',
    displayedMixedPort,
  )

  // 其他端口状态
  const socksPortCachedField = useCachedVergeConfigField(
    'verge_socks_port',
    7898,
  )
  const socksEnabledCachedField = useCachedVergeConfigField(
    'verge_socks_enabled',
    false,
  )
  const httpPortCachedField = useCachedVergeConfigField('verge_port', 7899)
  const httpEnabledCachedField = useCachedVergeConfigField(
    'verge_http_enabled',
    false,
  )
  const redirPortCachedField = useCachedVergeConfigField(
    'verge_redir_port',
    7895,
  )
  const redirEnabledCachedField = useCachedVergeConfigField(
    'verge_redir_enabled',
    false,
  )
  const tproxyPortCachedField = useCachedVergeConfigField(
    'verge_tproxy_port',
    7896,
  )
  const tproxyEnabledCachedField = useCachedVergeConfigField(
    'verge_tproxy_enabled',
    false,
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
      socksPortCachedField.refetch()
      socksEnabledCachedField.refetch()
      httpPortCachedField.refetch()
      httpEnabledCachedField.refetch()
      redirPortCachedField.refetch()
      redirEnabledCachedField.refetch()
      tproxyPortCachedField.refetch()
      tproxyEnabledCachedField.refetch()
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  // TODO 减少代码复杂度，性能开支
  const onSave = useLockFn(async () => {
    // 端口冲突检测
    const portList = [
      mixedPort,
      socksEnabledCachedField.value ? socksPortCachedField.value : -1,
      httpEnabledCachedField.value ? httpPortCachedField.value : -1,
      redirEnabledCachedField.value ? redirPortCachedField.value : -1,
      tproxyEnabledCachedField.value ? tproxyPortCachedField.value : -1,
    ].filter((p) => p !== -1)

    if (new Set(portList).size !== portList.length) {
      return
    }

    // 验证端口范围
    const isValidPort = (port: number) => port >= 1 && port <= 65535
    const allPortsValid = [
      mixedPort,
      socksEnabledCachedField.value ? socksPortCachedField.value : 0,
      httpEnabledCachedField.value ? httpPortCachedField.value : 0,
      redirEnabledCachedField.value ? redirPortCachedField.value : 0,
      tproxyEnabledCachedField.value ? tproxyPortCachedField.value : 0,
    ].every((port) => port === 0 || isValidPort(port))

    if (!allPortsValid) {
      return
    }

    await saveSettings({
      mixedPort,
      socks: {
        enabled: socksEnabledCachedField.value,
        port: socksPortCachedField.value,
      },
      http: {
        enabled: httpEnabledCachedField.value,
        port: httpPortCachedField.value,
      },
      redir: {
        enabled: redirEnabledCachedField.value,
        port: redirPortCachedField.value,
      },
      tproxy: {
        enabled: tproxyEnabledCachedField.value,
        port: tproxyPortCachedField.value,
      },
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
            modified={mixedPort !== mixedPortField.defaultValue}
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
                mixedPortField.defaultValue &&
                setMixedPort(mixedPortField.defaultValue)
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
              socksEnabledCachedField.modified || socksPortCachedField.modified
            }
            slotProps={{ primary: { sx: { fontSize: 12 } } }}
          />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <IconButton
              size="small"
              onClick={() => socksPortCachedField.set(generateRandomPort())}
              title={t('settings.modals.clashPort.actions.random')}
              disabled={!socksEnabledCachedField.value}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => socksPortCachedField.reset()}
              title={t('shared.actions.resetToDefault')}
              sx={{ mr: 0.5 }}
              disabled={!socksEnabledCachedField.value}
            >
              <RestartAltRounded fontSize="small" />
            </IconButton>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={socksPortCachedField.value}
              onChange={(e) =>
                socksPortCachedField.set(
                  +e.target.value?.replace(/\D+/, '').slice(0, 5),
                )
              }
              disabled={!socksEnabledCachedField.value}
              slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
            />
            <Switch
              size="small"
              checked={socksEnabledCachedField.value}
              onChange={(_, c) => socksEnabledCachedField.set(c)}
              sx={{ ml: 0.5 }}
            />
          </div>
        </ListItem>

        <ListItem sx={{ padding: '4px 0', minHeight: 36 }}>
          <SettingListItemText
            label={t('settings.modals.clashPort.fields.http')}
            modified={
              httpEnabledCachedField.modified || httpPortCachedField.modified
            }
            slotProps={{ primary: { sx: { fontSize: 12 } } }}
          />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <IconButton
              size="small"
              onClick={() => httpPortCachedField.set(generateRandomPort())}
              title={t('settings.modals.clashPort.actions.random')}
              disabled={!httpEnabledCachedField.value}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => httpPortCachedField.reset()}
              title={t('shared.actions.resetToDefault')}
              sx={{ mr: 0.5 }}
              disabled={!httpEnabledCachedField.value}
            >
              <RestartAltRounded fontSize="small" />
            </IconButton>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={httpPortCachedField.value}
              onChange={(e) =>
                httpPortCachedField.set(
                  +e.target.value?.replace(/\D+/, '').slice(0, 5),
                )
              }
              disabled={!httpEnabledCachedField.value}
              slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
            />
            <Switch
              size="small"
              checked={httpEnabledCachedField.value}
              onChange={(_, c) => httpEnabledCachedField.set(c)}
              sx={{ ml: 0.5 }}
            />
          </div>
        </ListItem>

        {OS !== 'windows' && (
          <ListItem sx={{ padding: '4px 0', minHeight: 36 }}>
            <SettingListItemText
              label={t('settings.modals.clashPort.fields.redir')}
              modified={
                redirEnabledCachedField.modified ||
                redirPortCachedField.modified
              }
              slotProps={{ primary: { sx: { fontSize: 12 } } }}
            />
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconButton
                size="small"
                onClick={() => redirPortCachedField.set(generateRandomPort())}
                title={t('settings.modals.clashPort.actions.random')}
                disabled={!redirEnabledCachedField.value}
                sx={{ mr: 0.5 }}
              >
                <Shuffle fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => redirPortCachedField.reset()}
                title={t('shared.actions.resetToDefault')}
                sx={{ mr: 0.5 }}
                disabled={!redirEnabledCachedField.value}
              >
                <RestartAltRounded fontSize="small" />
              </IconButton>
              <TextField
                size="small"
                sx={{ width: 80, mr: 0.5, fontSize: 12 }}
                value={redirPortCachedField.value}
                onChange={(e) =>
                  redirPortCachedField.set(
                    +e.target.value?.replace(/\D+/, '').slice(0, 5),
                  )
                }
                disabled={!redirEnabledCachedField.value}
                slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
              />
              <Switch
                size="small"
                checked={redirEnabledCachedField.value}
                onChange={(_, c) => redirEnabledCachedField.set(c)}
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
                tproxyEnabledCachedField.modified ||
                tproxyPortCachedField.modified
              }
              slotProps={{ primary: { sx: { fontSize: 12 } } }}
            />
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <IconButton
                size="small"
                onClick={() => tproxyPortCachedField.set(generateRandomPort())}
                title={t('settings.modals.clashPort.actions.random')}
                disabled={!tproxyEnabledCachedField.value}
                sx={{ mr: 0.5 }}
              >
                <Shuffle fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => tproxyPortCachedField.reset()}
                title={t('shared.actions.resetToDefault')}
                sx={{ mr: 0.5 }}
                disabled={!tproxyEnabledCachedField.value}
              >
                <RestartAltRounded fontSize="small" />
              </IconButton>
              <TextField
                size="small"
                sx={{ width: 80, mr: 0.5, fontSize: 12 }}
                value={tproxyPortCachedField.value}
                onChange={(e) =>
                  tproxyPortCachedField.set(
                    +e.target.value?.replace(/\D+/, '').slice(0, 5),
                  )
                }
                disabled={!tproxyEnabledCachedField.value}
                slotProps={{ htmlInput: { style: { fontSize: 12 } } }}
              />
              <Switch
                size="small"
                checked={tproxyEnabledCachedField.value}
                onChange={(_, c) => tproxyEnabledCachedField.set(c)}
                sx={{ ml: 0.5 }}
              />
            </div>
          </ListItem>
        )}
      </List>
    </BaseDialog>
  )
})
