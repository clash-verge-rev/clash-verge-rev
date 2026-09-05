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
import { useCachedVergeConfigField } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'

import SettingListItemText from './setting-list-item-text-comp'

export const MiscViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)
  const appLogLevelField = useCachedVergeConfigField('app_log_level', 'warn')
  const appLogMaxSizeField = useCachedVergeConfigField('app_log_max_size', 128)
  const appLogMaxCountField = useCachedVergeConfigField('app_log_max_count', 8)
  const autoCloseConnectionField = useCachedVergeConfigField(
    'auto_close_connection',
    true,
  )
  const autoCheckUpdateField = useCachedVergeConfigField(
    'auto_check_update',
    true,
  )
  const enableBuiltinEnhancedField = useCachedVergeConfigField(
    'enable_builtin_enhanced',
    true,
  )
  const proxyLayoutColumnField = useCachedVergeConfigField(
    'proxy_layout_column',
    6,
  )
  const enableAutoDelayDetectionField = useCachedVergeConfigField(
    'enable_auto_delay_detection',
    false,
  )
  const autoDelayDetectionIntervalMinutesField = useCachedVergeConfigField(
    'auto_delay_detection_interval_minutes',
    5,
  )
  const defaultLatencyTestField = useCachedVergeConfigField(
    'default_latency_test',
    '',
  )
  const autoLogCleanField = useCachedVergeConfigField('auto_log_clean', 2)
  const defaultLatencyTimeoutField = useCachedVergeConfigField(
    'default_latency_timeout',
    10000,
  )

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
      appLogLevelField.refetch()
      appLogMaxSizeField.refetch()
      appLogMaxCountField.refetch()
      autoCloseConnectionField.refetch()
      autoCheckUpdateField.refetch()
      enableBuiltinEnhancedField.refetch()
      proxyLayoutColumnField.refetch()
      enableAutoDelayDetectionField.refetch()
      autoDelayDetectionIntervalMinutesField.refetch()
      defaultLatencyTestField.refetch()
      autoLogCleanField.refetch()
      defaultLatencyTimeoutField.refetch()
    },
    close: () => setOpen(false),
  }))

  const onSave = useLockFn(async () => {
    try {
      await Promise.all([
        appLogLevelField.save(),
        appLogMaxSizeField.save(),
        appLogMaxCountField.save(),
        autoCloseConnectionField.save(),
        autoCheckUpdateField.save(),
        enableBuiltinEnhancedField.save(),
        proxyLayoutColumnField.save(),
        enableAutoDelayDetectionField.save(),
        autoDelayDetectionIntervalMinutesField.save(),
        defaultLatencyTestField.save(),
        defaultLatencyTimeoutField.save(),
        autoLogCleanField.save(),
      ])
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
              appLogLevelField.reset()
              appLogMaxSizeField.reset()
              appLogMaxCountField.reset()
              autoCloseConnectionField.reset()
              autoCheckUpdateField.reset()
              enableBuiltinEnhancedField.reset()
              proxyLayoutColumnField.reset()
              enableAutoDelayDetectionField.reset()
              autoDelayDetectionIntervalMinutesField.reset()
              defaultLatencyTestField.reset()
              autoLogCleanField.reset()
              defaultLatencyTimeoutField.reset()
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
            modified={appLogLevelField.modified}
          />
          <Select
            size="small"
            sx={{ width: 100, '> div': { py: '7.5px' } }}
            value={appLogLevelField.value}
            onChange={(e) => appLogLevelField.set(e.target.value as string)}
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
            modified={appLogMaxSizeField.modified}
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
            value={appLogMaxSizeField.value}
            onChange={(e) =>
              appLogMaxSizeField.set(
                Math.max(1, parseInt(e.target.value) || 128),
              )
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
            modified={appLogMaxCountField.modified}
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
            value={appLogMaxCountField.value}
            onChange={(e) =>
              appLogMaxCountField.set(
                Math.max(1, parseInt(e.target.value) || 1),
              )
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
            modified={autoCloseConnectionField.modified}
            sx={{ maxWidth: 'fit-content' }}
          />
          <TooltipIcon
            title={t('settings.modals.misc.tooltips.autoCloseConnections')}
            sx={{ opacity: '0.7' }}
          />
          <Switch
            edge="end"
            checked={autoCloseConnectionField.value}
            onChange={(_, c) => autoCloseConnectionField.set(c)}
            sx={{ marginLeft: 'auto' }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.autoCheckUpdate')}
            modified={autoCheckUpdateField.modified}
          />
          <Switch
            edge="end"
            checked={autoCheckUpdateField.value}
            onChange={(_, c) => autoCheckUpdateField.set(c)}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.enableBuiltinEnhanced')}
            modified={enableBuiltinEnhancedField.modified}
            sx={{ maxWidth: 'fit-content' }}
          />
          <TooltipIcon
            title={t('settings.modals.misc.tooltips.enableBuiltinEnhanced')}
            sx={{ opacity: '0.7' }}
          />
          <Switch
            edge="end"
            checked={enableBuiltinEnhancedField.value}
            onChange={(_, c) => enableBuiltinEnhancedField.set(c)}
            sx={{ marginLeft: 'auto' }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.proxyLayoutColumns')}
            modified={proxyLayoutColumnField.modified}
          />
          <Select
            size="small"
            sx={{ width: 160, '> div': { py: '7.5px' } }}
            value={proxyLayoutColumnField.value}
            onChange={(e) =>
              proxyLayoutColumnField.set(e.target.value as number)
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
            modified={autoLogCleanField.modified}
          />
          <Select
            size="small"
            sx={{ width: 160, '> div': { py: '7.5px' } }}
            value={autoLogCleanField.value}
            onChange={(e) =>
              autoLogCleanField.set(e.target.value as 0 | 1 | 2 | 3 | 4)
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
            modified={enableAutoDelayDetectionField.modified}
            sx={{ maxWidth: 'fit-content' }}
          />
          <TooltipIcon
            title={t('settings.modals.misc.tooltips.autoDelayDetection')}
            sx={{ opacity: '0.7' }}
          />
          <Switch
            edge="end"
            checked={enableAutoDelayDetectionField.value}
            onChange={(_, c) => enableAutoDelayDetectionField.set(c)}
            sx={{ marginLeft: 'auto' }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.autoDelayDetectionInterval')}
            modified={autoDelayDetectionIntervalMinutesField.modified}
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
            value={autoDelayDetectionIntervalMinutesField.value}
            disabled={!enableAutoDelayDetectionField.value}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10)
              const intervalMinutes =
                Number.isFinite(parsed) && parsed > 0 ? parsed : 1
              autoDelayDetectionIntervalMinutesField.set(intervalMinutes)
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
            modified={defaultLatencyTestField.modified}
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
            value={defaultLatencyTestField.value}
            placeholder="http://cp.cloudflare.com/generate_204"
            onChange={(e) => defaultLatencyTestField.set(e.target.value)}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <SettingListItemText
            label={t('settings.modals.misc.fields.defaultLatencyTimeout')}
            modified={defaultLatencyTimeoutField.modified}
          />
          <TextField
            autoComplete="new-password"
            size="small"
            type="number"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            sx={{ width: 250 }}
            value={defaultLatencyTimeoutField.value}
            placeholder="10000"
            onChange={(e) =>
              defaultLatencyTimeoutField.set(parseInt(e.target.value))
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
