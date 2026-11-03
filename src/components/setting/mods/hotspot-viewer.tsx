import {
  Alert,
  Autocomplete,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, type DialogRef, Switch } from '@/components/base'
import { DEFAULT_HOTSPOT_SSID, useHotspotAdapters } from '@/hooks/use-hotspot'
import { useVerge } from '@/hooks/use-verge'
import { saveHotspotConfig } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import type { TranslationKey } from '@/types/generated/i18n-keys'

interface Props {
  onError?: (error: Error) => void
}

const BANDS = ['auto', '2.4', '5'] as const

const BAND_KEYS: Record<(typeof BANDS)[number], TranslationKey> = {
  auto: 'settings.modals.hotspot.bands.auto',
  '2.4': 'settings.modals.hotspot.bands.band24',
  '5': 'settings.modals.hotspot.bands.band5',
}

const HotspotViewer = forwardRef<DialogRef, Props>(({ onError }, ref) => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const adapters = useHotspotAdapters()

  const [open, setOpen] = useState(false)
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [band, setBand] = useState<string>('auto')
  const [adapterId, setAdapterId] = useState<string | null>(null)
  const [autoStart, setAutoStart] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    open: () => {
      setSsid(verge?.hotspot_ssid || DEFAULT_HOTSPOT_SSID)
      setPassword(verge?.hotspot_password ?? '')
      setBand(verge?.hotspot_band ?? 'auto')
      setAdapterId(verge?.hotspot_adapter_id || null)
      setAutoStart(verge?.hotspot_auto_start ?? false)
      setError(null)
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  const onSave = useLockFn(async () => {
    setError(null)
    const name = ssid.trim()
    if (!name || new TextEncoder().encode(name).length > 32) {
      setError(t('settings.modals.hotspot.messages.invalidSsid'))
      showNotice.error('settings.modals.hotspot.messages.invalidSsid')
      return
    }
    if (
      password.length < 8 ||
      password.length > 63 ||
      !/^[\x20-\x7e]+$/.test(password)
    ) {
      setError(t('settings.modals.hotspot.messages.invalidPassword'))
      showNotice.error('settings.modals.hotspot.messages.invalidPassword')
      return
    }

    setSaving(true)
    try {
      await mutate(
        () =>
          saveHotspotConfig({
            ssid: name,
            password,
            band,
            adapterId: adapterId ?? null,
            autoStart,
          }),
        {
          id: 'save-hotspot-config',
          revalidate: [['getVergeConfig'], ['getHotspotStatus']],
          errorNotice: false,
        },
      )
      setOpen(false)
      showNotice.success('settings.modals.hotspot.messages.saved')
    } catch (error) {
      setError((error as Error).message)
      onError?.(error as Error)
    } finally {
      setSaving(false)
    }
  })

  return (
    <BaseDialog
      open={open}
      title={t('settings.modals.hotspot.title')}
      contentSx={{ width: 460 }}
      okBtn={t('shared.actions.save')}
      cancelBtn={t('shared.actions.cancel')}
      loading={saving}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <ListItem sx={{ padding: '5px 2px' }}>
        <ListItemText primary={t('settings.modals.hotspot.fields.ssid')} />
        <TextField
          autoComplete="off"
          size="small"
          value={ssid}
          placeholder="ClashVerge"
          onChange={(event) => setSsid(event.target.value)}
          sx={{ width: 250 }}
        />
      </ListItem>

      <ListItem sx={{ padding: '5px 2px' }}>
        <ListItemText
          primary={t('settings.modals.hotspot.fields.password')}
          secondary={t('settings.modals.hotspot.tooltips.password')}
        />
        <TextField
          autoComplete="new-password"
          size="small"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          sx={{ width: 250 }}
        />
      </ListItem>

      <ListItem sx={{ padding: '5px 2px' }}>
        <ListItemText primary={t('settings.modals.hotspot.fields.band')} />
        <Select
          size="small"
          value={band}
          onChange={(event) => setBand(event.target.value)}
          sx={{ width: 250, '> div': { py: '7.5px' } }}
        >
          {BANDS.map((value) => (
            <MenuItem key={value} value={value}>
              {t(BAND_KEYS[value])}
            </MenuItem>
          ))}
        </Select>
      </ListItem>

      <ListItem sx={{ padding: '5px 2px' }}>
        <ListItemText primary={t('settings.modals.hotspot.fields.adapter')} />
        <Autocomplete
          size="small"
          options={adapters}
          value={adapters.find((adapter) => adapter.id === adapterId) ?? null}
          getOptionLabel={(adapter) =>
            adapter.description
              ? `${adapter.name} · ${adapter.description}`
              : adapter.name
          }
          isOptionEqualToValue={(option, value) => option.id === value.id}
          onChange={(_, value) => setAdapterId(value?.id ?? null)}
          renderInput={(params) => (
            <TextField
              {...params}
              size="small"
              placeholder={t('settings.modals.hotspot.fields.adapterAuto')}
            />
          )}
          sx={{ width: 250 }}
        />
      </ListItem>

      <ListItem sx={{ padding: '5px 2px' }}>
        <ListItemText
          primary={t('settings.modals.hotspot.fields.autoStart')}
          secondary={t('settings.modals.hotspot.tooltips.autoStart')}
        />
        <Switch
          edge="end"
          checked={autoStart}
          onChange={(event) => setAutoStart(event.target.checked)}
        />
      </ListItem>

      <ListItem sx={{ padding: '5px 2px' }}>
        <ListItemText
          primary={t('settings.modals.hotspot.fields.requiresTun')}
          secondary={t('settings.modals.hotspot.tooltips.requiresTun')}
        />
      </ListItem>
    </BaseDialog>
  )
})

export default HotspotViewer
