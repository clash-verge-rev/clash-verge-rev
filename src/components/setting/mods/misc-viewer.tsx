import { RestartAltRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  InputAdornment,
  List,
  ListItem,
  MenuItem,
  Select,
  TextField,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef, Switch, TooltipIcon } from '@/components/base'
import { useDefaultVergeConfig, useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'

import SettingListItemText from './setting-list-item-text-comp'

export const MiscViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()

  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<{
    appLogLevel?: string
    appLogMaxSize?: number
    appLogMaxCount?: number
    autoCloseConnection?: boolean
    autoCheckUpdate?: boolean
    enableBuiltinEnhanced?: boolean
    proxyLayoutColumn?: number
    enableAutoDelayDetection?: boolean
    autoDelayDetectionIntervalMinutes?: number
    defaultLatencyTest?: string
    autoLogClean?: number
    defaultLatencyTimeout?: number
  }>({})
  const {
    app_log_level: defaultAppLogLevel,
    app_log_max_size: defaultAppLogMaxSize,
    app_log_max_count: defaultAppLogMaxCount,
    auto_close_connection: defaultAutoCloseConnection,
    auto_check_update: defaultAutoCheckUpdate,
    enable_builtin_enhanced: defaultEnableBuiltinEnhanced,
    proxy_layout_column: defaultProxyLayoutColumn,
    enable_auto_delay_detection: defaultEnableAutoDelayDetection,
    auto_delay_detection_interval_minutes:
      defaultAutoDelayDetectionIntervalMinutes,
    default_latency_test: defaultDefaultLatencyTest,
    auto_log_clean: defaultAutoLogClean,
    default_latency_timeout: defaultDefaultLatencyTimeout,
  } = useDefaultVergeConfig() ?? {}

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
      setValues({
        appLogLevel: verge?.app_log_level ?? defaultAppLogLevel,
        appLogMaxSize: verge?.app_log_max_size ?? defaultAppLogMaxSize,
        appLogMaxCount: verge?.app_log_max_count ?? defaultAppLogMaxCount,
        autoCloseConnection:
          verge?.auto_close_connection ?? defaultAutoCloseConnection,
        autoCheckUpdate: verge?.auto_check_update ?? defaultAutoCheckUpdate,
        enableBuiltinEnhanced:
          verge?.enable_builtin_enhanced ?? defaultEnableBuiltinEnhanced,
        proxyLayoutColumn:
          verge?.proxy_layout_column ?? defaultProxyLayoutColumn,
        enableAutoDelayDetection:
          verge?.enable_auto_delay_detection ?? defaultEnableAutoDelayDetection,
        autoDelayDetectionIntervalMinutes:
          verge?.auto_delay_detection_interval_minutes ??
          defaultAutoDelayDetectionIntervalMinutes,
        defaultLatencyTest:
          verge?.default_latency_test ?? defaultDefaultLatencyTest,
        autoLogClean: verge?.auto_log_clean ?? defaultAutoLogClean,
        defaultLatencyTimeout:
          verge?.default_latency_timeout ?? defaultDefaultLatencyTimeout,
      })
    },
    close: () => setOpen(false),
  }))

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({
        app_log_level: values.appLogLevel,
        app_log_max_size: values.appLogMaxSize,
        app_log_max_count: values.appLogMaxCount,
        auto_close_connection: values.autoCloseConnection,
        auto_check_update: values.autoCheckUpdate,
        enable_builtin_enhanced: values.enableBuiltinEnhanced,
        proxy_layout_column: values.proxyLayoutColumn,
        enable_auto_delay_detection: values.enableAutoDelayDetection,
        auto_delay_detection_interval_minutes:
          values.autoDelayDetectionIntervalMinutes,
        default_latency_test: values.defaultLatencyTest,
        default_latency_timeout: values.defaultLatencyTimeout,
        auto_log_clean: values.autoLogClean as any,
      })
      setOpen(false)
    } catch (err) {
      showNotice.error(err)
    }
  })

  return (
    <BaseDialog
      open={open}
      title={
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {t('settings.modals.misc.title')}
          <Button
            variant="outlined"
            size="small"
            color="warning"
            startIcon={<RestartAltRounded />}
            onClick={() => {
              setValues({
                appLogLevel: defaultAppLogLevel,
                appLogMaxSize: defaultAppLogMaxSize,
                appLogMaxCount: defaultAppLogMaxCount,
                autoCloseConnection: defaultAutoCloseConnection,
                autoCheckUpdate: defaultAutoCheckUpdate,
                enableBuiltinEnhanced: defaultEnableBuiltinEnhanced,
                proxyLayoutColumn: defaultProxyLayoutColumn,
                enableAutoDelayDetection: defaultEnableAutoDelayDetection,
                autoDelayDetectionIntervalMinutes:
                  defaultAutoDelayDetectionIntervalMinutes,
                defaultLatencyTest: defaultDefaultLatencyTest,
                autoLogClean: defaultAutoLogClean,
                defaultLatencyTimeout: defaultDefaultLatencyTimeout,
              })
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
          <SettingListItemText
            label={t('settings.modals.misc.fields.appLogLevel')}
            modified={values.appLogLevel !== defaultAppLogLevel}
          />
          <Select
            size="small"
            sx={{ width: 100, '> div': { py: '7.5px' } }}
            value={values.appLogLevel}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                appLogLevel: e.target.value as string,
              }))
            }
          >
            {['trace', 'debug', 'info', 'warn', 'error', 'silent'].map((i) => (
              <MenuItem value={i} key={i}>
                {i[0].toUpperCase() + i.slice(1).toLowerCase()}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.appLogMaxSize')}
            modified={values.appLogMaxSize !== defaultAppLogMaxSize}
            sx={{ maxWidth: 'fit-content' }}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 140, marginLeft: 'auto' }}
            value={values.appLogMaxSize}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                appLogMaxSize: Math.max(1, parseInt(e.target.value) || 128),
              }))
            }
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t('shared.units.kilobytes')}
                  </InputAdornment>
                ),
              },
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.appLogMaxCount')}
            modified={values.appLogMaxCount !== defaultAppLogMaxCount}
            sx={{ maxWidth: 'fit-content' }}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 140, marginLeft: 'auto' }}
            value={values.appLogMaxCount}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                appLogMaxCount: Math.max(1, parseInt(e.target.value) || 1),
              }))
            }
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t('shared.units.files')}
                  </InputAdornment>
                ),
              },
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.autoCloseConnections')}
            modified={values.autoCloseConnection !== defaultAutoCloseConnection}
            sx={{ maxWidth: 'fit-content' }}
          />
          <TooltipIcon
            title={t('settings.modals.misc.tooltips.autoCloseConnections')}
            sx={{ opacity: '0.7' }}
          />
          <Switch
            edge="end"
            checked={values.autoCloseConnection}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoCloseConnection: c }))
            }
            sx={{ marginLeft: 'auto' }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.autoCheckUpdate')}
            modified={values.autoCheckUpdate !== defaultAutoCheckUpdate}
          />
          <Switch
            edge="end"
            checked={values.autoCheckUpdate}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoCheckUpdate: c }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.enableBuiltinEnhanced')}
            modified={
              values.enableBuiltinEnhanced !== defaultEnableBuiltinEnhanced
            }
            sx={{ maxWidth: 'fit-content' }}
          />
          <TooltipIcon
            title={t('settings.modals.misc.tooltips.enableBuiltinEnhanced')}
            sx={{ opacity: '0.7' }}
          />
          <Switch
            edge="end"
            checked={values.enableBuiltinEnhanced}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, enableBuiltinEnhanced: c }))
            }
            sx={{ marginLeft: 'auto' }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.proxyLayoutColumns')}
            modified={values.proxyLayoutColumn !== defaultProxyLayoutColumn}
          />
          <Select
            size="small"
            sx={{ width: 160, '> div': { py: '7.5px' } }}
            value={values.proxyLayoutColumn}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                proxyLayoutColumn: e.target.value as number,
              }))
            }
          >
            <MenuItem value={6} key={6}>
              {t('settings.modals.misc.options.proxyLayoutColumns.auto')}
            </MenuItem>
            {[1, 2, 3, 4, 5].map((i) => (
              <MenuItem value={i} key={i}>
                {i}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.autoLogClean')}
            modified={values.autoLogClean !== defaultAutoLogClean}
          />
          <Select
            size="small"
            sx={{ width: 160, '> div': { py: '7.5px' } }}
            value={values.autoLogClean}
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                autoLogClean: e.target.value as number,
              }))
            }
          >
            {/* 1: 1天, 2: 7天, 3: 30天, 4: 90天*/}
            {[
              {
                key: t('settings.modals.misc.options.autoLogClean.never'),
                value: 0,
              },
              {
                key: t('settings.modals.misc.options.autoLogClean.retainDays', {
                  n: 1,
                }),
                value: 1,
              },
              {
                key: t('settings.modals.misc.options.autoLogClean.retainDays', {
                  n: 7,
                }),
                value: 2,
              },
              {
                key: t('settings.modals.misc.options.autoLogClean.retainDays', {
                  n: 30,
                }),
                value: 3,
              },
              {
                key: t('settings.modals.misc.options.autoLogClean.retainDays', {
                  n: 90,
                }),
                value: 4,
              },
            ].map((i) => (
              <MenuItem key={i.value} value={i.value}>
                {i.key}
              </MenuItem>
            ))}
          </Select>
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.autoDelayDetection')}
            modified={
              values.enableAutoDelayDetection !==
              defaultEnableAutoDelayDetection
            }
            sx={{ maxWidth: 'fit-content' }}
          />
          <TooltipIcon
            title={t('settings.modals.misc.tooltips.autoDelayDetection')}
            sx={{ opacity: '0.7' }}
          />
          <Switch
            edge="end"
            checked={values.enableAutoDelayDetection}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, enableAutoDelayDetection: c }))
            }
            sx={{ marginLeft: 'auto' }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.autoDelayDetectionInterval')}
            modified={
              values.autoDelayDetectionIntervalMinutes !==
              defaultAutoDelayDetectionIntervalMinutes
            }
            sx={{ maxWidth: 'fit-content' }}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 160, marginLeft: 'auto' }}
            value={values.autoDelayDetectionIntervalMinutes}
            disabled={!values.enableAutoDelayDetection}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10)
              const intervalMinutes =
                Number.isFinite(parsed) && parsed > 0 ? parsed : 1
              setValues((v) => ({
                ...v,
                autoDelayDetectionIntervalMinutes: intervalMinutes,
              }))
            }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t('shared.units.minutes')}
                  </InputAdornment>
                ),
              },
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.defaultLatencyTest')}
            modified={values.defaultLatencyTest !== defaultDefaultLatencyTest}
            sx={{ maxWidth: 'fit-content' }}
          />
          <TooltipIcon
            title={t('settings.modals.misc.tooltips.defaultLatencyTest')}
            sx={{ opacity: '0.7' }}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250, marginLeft: 'auto' }}
            value={values.defaultLatencyTest}
            placeholder="http://cp.cloudflare.com/generate_204"
            onChange={(e) =>
              setValues((v) => ({ ...v, defaultLatencyTest: e.target.value }))
            }
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.defaultLatencyTimeout')}
            modified={
              values.defaultLatencyTimeout !== defaultDefaultLatencyTimeout
            }
          />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={values.defaultLatencyTimeout}
            placeholder="10000"
            onChange={(e) =>
              setValues((v) => ({
                ...v,
                defaultLatencyTimeout: parseInt(e.target.value),
              }))
            }
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t('shared.units.milliseconds')}
                  </InputAdornment>
                ),
              },
            }}
          />
        </ListItem>
      </List>
    </BaseDialog>
  )
})
