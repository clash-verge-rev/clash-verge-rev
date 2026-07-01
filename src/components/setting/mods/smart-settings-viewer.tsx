import { RestartAltRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef, Switch } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { flushSmartCache, upgradeLightgbmModel } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const DEFAULT_LGBM_URL =
  'https://github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model.bin'
const DEFAULT_POLICY_PRIORITY = 'Premium:0.9;SG:1.3'

const LGBM_MODEL_URLS = {
  large:
    'https://github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model-large.bin',
  middle:
    'https://github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model-middle.bin',
  default: DEFAULT_LGBM_URL,
}

type LgbmModelPreset = keyof typeof LGBM_MODEL_URLS | 'custom'

type SmartSettings = {
  strategyAutoSwitch: boolean
  policyPriority: string
  preferAsn: boolean
  useLightgbm: boolean
  collectData: boolean
  sampleRate: number
  lgbmAutoUpdate: boolean
  lgbmUpdateInterval: number
  lgbmModelPreset: LgbmModelPreset
  lgbmUrl: string
  smartCollectorSize: number
}

const DEFAULT_VALUES: SmartSettings = {
  strategyAutoSwitch: false,
  policyPriority: DEFAULT_POLICY_PRIORITY,
  preferAsn: false,
  useLightgbm: false,
  collectData: false,
  sampleRate: 1,
  lgbmAutoUpdate: false,
  lgbmUpdateInterval: 72,
  lgbmModelPreset: 'default',
  lgbmUrl: DEFAULT_LGBM_URL,
  smartCollectorSize: 100,
}

const getLgbmModelPreset = (url?: string): LgbmModelPreset => {
  const normalized = url?.trim()
  const matched = Object.entries(LGBM_MODEL_URLS).find(
    ([, modelUrl]) => modelUrl === normalized,
  )
  return (matched?.[0] as LgbmModelPreset | undefined) ?? 'custom'
}

const isKnownLgbmModelUrl = (url: string) =>
  Object.values(LGBM_MODEL_URLS).includes(url.trim())

const resolveLgbmUrl = (values: SmartSettings) => {
  if (values.lgbmModelPreset !== 'custom') {
    return LGBM_MODEL_URLS[values.lgbmModelPreset]
  }
  return values.lgbmUrl.trim() || DEFAULT_LGBM_URL
}

const toNumber = (
  value: string,
  fallback: number,
  min: number,
  max?: number,
) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const upperBounded = max == null ? parsed : Math.min(parsed, max)
  return Math.max(min, upperBounded)
}

export function SmartSettingsViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()
  const isSmartCore = verge?.clash_core === 'verge-mihomo-smart'

  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<SmartSettings>(DEFAULT_VALUES)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [updatingModel, setUpdatingModel] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [resettingDefaults, setResettingDefaults] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => {
      setValues({
        strategyAutoSwitch: verge?.smart_strategy_auto_switch ?? false,
        policyPriority: verge?.smart_policy_priority ?? DEFAULT_POLICY_PRIORITY,
        preferAsn: verge?.smart_prefer_asn ?? false,
        useLightgbm: verge?.smart_use_lightgbm ?? false,
        collectData: verge?.smart_collect_data ?? false,
        sampleRate: verge?.smart_sample_rate ?? 1,
        lgbmAutoUpdate: verge?.smart_lgbm_auto_update ?? false,
        lgbmUpdateInterval: verge?.smart_lgbm_update_interval ?? 72,
        lgbmModelPreset: getLgbmModelPreset(verge?.smart_lgbm_url),
        lgbmUrl: verge?.smart_lgbm_url || DEFAULT_LGBM_URL,
        smartCollectorSize: verge?.smart_collector_size ?? 100,
      })
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  const updateValues = (patch: Partial<SmartSettings>) => {
    setValues((prev) => ({ ...prev, ...patch }))
  }

  const updateLgbmModelPreset = (preset: LgbmModelPreset) => {
    if (preset === 'custom') {
      updateValues({
        lgbmModelPreset: preset,
        lgbmUrl: isKnownLgbmModelUrl(values.lgbmUrl) ? '' : values.lgbmUrl,
      })
      return
    }

    updateValues({
      lgbmModelPreset: preset,
      lgbmUrl: LGBM_MODEL_URLS[preset],
    })
  }

  const saveSmartSettings = (nextValues = values) =>
    patchVerge({
      smart_strategy_auto_switch: nextValues.strategyAutoSwitch,
      smart_policy_priority: nextValues.policyPriority.trim(),
      smart_prefer_asn: nextValues.preferAsn,
      smart_use_lightgbm: nextValues.useLightgbm,
      smart_collect_data: nextValues.collectData,
      smart_sample_rate: nextValues.sampleRate,
      smart_lgbm_auto_update: nextValues.lgbmAutoUpdate,
      smart_lgbm_update_interval: nextValues.lgbmUpdateInterval,
      smart_lgbm_url: resolveLgbmUrl(nextValues),
      smart_collector_size: nextValues.smartCollectorSize,
    })

  const resetToDefaults = useLockFn(async () => {
    try {
      setResettingDefaults(true)
      setValues(DEFAULT_VALUES)
      await saveSmartSettings(DEFAULT_VALUES)
      showNotice.success('shared.feedback.notifications.saved')
    } catch (err) {
      showNotice.error(err)
    } finally {
      setResettingDefaults(false)
    }
  })

  const onSave = useLockFn(async () => {
    try {
      await saveSmartSettings()
      showNotice.success('shared.feedback.notifications.saved')
      setOpen(false)
    } catch (err) {
      showNotice.error(err)
    }
  })

  const onUpgradeModel = useLockFn(async () => {
    if (!isSmartCore) {
      showNotice.error('settings.modals.smart.messages.smartCoreRequired')
      return
    }

    try {
      setUpdatingModel(true)
      await saveSmartSettings()
      await upgradeLightgbmModel()
      showNotice.success('settings.modals.smart.messages.modelUpdated')
    } catch (err) {
      showNotice.error(err)
    } finally {
      setUpdatingModel(false)
    }
  })

  const onClearCache = useLockFn(async () => {
    if (!isSmartCore) {
      showNotice.error('settings.modals.smart.messages.smartCoreRequired')
      return
    }

    try {
      setClearingCache(true)
      await flushSmartCache()
      showNotice.success('settings.modals.smart.messages.cacheCleared')
      setConfirmClearOpen(false)
    } catch (err) {
      showNotice.error(err)
    } finally {
      setClearingCache(false)
    }
  })

  return (
    <>
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
            {t('settings.modals.smart.title')}
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<RestartAltRounded />}
              loading={resettingDefaults}
              onClick={resetToDefaults}
            >
              {t('shared.actions.resetToDefault')}
            </Button>
          </Box>
        }
        contentSx={{ width: 560 }}
        okBtn={t('shared.actions.save')}
        cancelBtn={t('shared.actions.cancel')}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onOk={onSave}
      >
        <List>
          {!isSmartCore && (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {t('settings.modals.smart.nonSmartCoreWarning')}
            </Alert>
          )}

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.strategyAutoSwitch')}
            />
            <Switch
              edge="end"
              checked={values.strategyAutoSwitch}
              onChange={(_, checked) =>
                updateValues({ strategyAutoSwitch: checked })
              }
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.policyPriority')}
            />
            <TextField
              autoComplete="new-password"
              placeholder={DEFAULT_POLICY_PRIORITY}
              size="small"
              sx={{ width: 330 }}
              value={values.policyPriority}
              onChange={(e) => updateValues({ policyPriority: e.target.value })}
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.preferAsn')}
            />
            <Switch
              edge="end"
              checked={values.preferAsn}
              onChange={(_, checked) => updateValues({ preferAsn: checked })}
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.useLightgbm')}
            />
            <Switch
              edge="end"
              checked={values.useLightgbm}
              onChange={(_, checked) => updateValues({ useLightgbm: checked })}
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.collectData')}
            />
            <Switch
              edge="end"
              checked={values.collectData}
              onChange={(_, checked) => updateValues({ collectData: checked })}
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.collectorSize')}
            />
            <TextField
              autoComplete="new-password"
              size="small"
              type="number"
              sx={{ width: 160 }}
              value={values.smartCollectorSize}
              onChange={(e) =>
                updateValues({
                  smartCollectorSize: toNumber(e.target.value, 100, 1),
                })
              }
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">MB</InputAdornment>
                  ),
                },
              }}
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.sampleRate')}
            />
            <TextField
              autoComplete="new-password"
              size="small"
              type="number"
              sx={{ width: 160 }}
              value={values.sampleRate}
              onChange={(e) =>
                updateValues({
                  sampleRate: toNumber(e.target.value, 1, 0, 1),
                })
              }
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.autoUpdate')}
            />
            <Switch
              edge="end"
              checked={values.lgbmAutoUpdate}
              onChange={(_, checked) =>
                updateValues({ lgbmAutoUpdate: checked })
              }
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.updateInterval')}
            />
            <TextField
              autoComplete="new-password"
              size="small"
              type="number"
              sx={{ width: 160 }}
              value={values.lgbmUpdateInterval}
              onChange={(e) =>
                updateValues({
                  lgbmUpdateInterval: toNumber(e.target.value, 72, 1),
                })
              }
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t('shared.units.hours')}
                    </InputAdornment>
                  ),
                },
              }}
            />
          </ListItem>

          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.smart.fields.modelUrl')}
            />
            <TextField
              autoComplete="new-password"
              select
              size="small"
              sx={{ width: 330 }}
              value={values.lgbmModelPreset}
              onChange={(e) =>
                updateLgbmModelPreset(e.target.value as LgbmModelPreset)
              }
            >
              <MenuItem value="large">
                {t('settings.modals.smart.modelOptions.large')}
              </MenuItem>
              <MenuItem value="middle">
                {t('settings.modals.smart.modelOptions.middle')}
              </MenuItem>
              <MenuItem value="default">
                {t('settings.modals.smart.modelOptions.default')}
              </MenuItem>
              <MenuItem value="custom">
                {t('settings.modals.smart.modelOptions.custom')}
              </MenuItem>
            </TextField>
          </ListItem>

          {values.lgbmModelPreset === 'custom' && (
            <ListItem sx={{ padding: '5px 2px' }}>
              <ListItemText
                primary={t('settings.modals.smart.fields.customModelUrl')}
              />
              <TextField
                autoComplete="new-password"
                size="small"
                sx={{ width: 330 }}
                placeholder={DEFAULT_LGBM_URL}
                value={values.lgbmUrl}
                onChange={(e) => updateValues({ lgbmUrl: e.target.value })}
              />
            </ListItem>
          )}

          <ListItem sx={{ padding: '8px 2px 0' }}>
            <ListItemText primary={t('settings.modals.smart.fields.actions')} />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                loading={updatingModel}
                disabled={!isSmartCore}
                onClick={onUpgradeModel}
              >
                {t('settings.modals.smart.actions.updateModel')}
              </Button>
              <Button
                color="warning"
                variant="outlined"
                disabled={!isSmartCore}
                onClick={() => setConfirmClearOpen(true)}
              >
                {t('settings.modals.smart.actions.clearCache')}
              </Button>
            </Stack>
          </ListItem>
        </List>
      </BaseDialog>

      <BaseDialog
        open={confirmClearOpen}
        title={t('settings.modals.smart.confirmClear.title')}
        okBtn={t('shared.actions.confirm')}
        cancelBtn={t('shared.actions.cancel')}
        loading={clearingCache}
        onClose={() => !clearingCache && setConfirmClearOpen(false)}
        onCancel={() => !clearingCache && setConfirmClearOpen(false)}
        onOk={onClearCache}
      >
        {t('settings.modals.smart.confirmClear.message')}
      </BaseDialog>
    </>
  )
}
