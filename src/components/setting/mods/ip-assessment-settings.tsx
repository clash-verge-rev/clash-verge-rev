import { AddRounded, DeleteOutlineRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useIpAssessmentProviders } from '@/hooks/use-ip-assessment'
import {
  IP_ASSESSMENT_PROVIDER_URLS,
  isHttpsAssessmentUrl,
  type IpAssessmentProvider,
  type IpAssessmentProviderType,
} from '@/services/ip-assessment'
import { showNotice } from '@/services/notice-service'

const PROVIDER_LABELS: Record<IpAssessmentProviderType, string> = {
  ipapi: 'ipapi.is',
  cleanip: 'cleanip.io',
  ipinfo: 'IPinfo',
}

type Row = IpAssessmentProvider & { id: number }
let rowSeq = 0
const toRow = (provider: IpAssessmentProvider): Row => ({
  ...provider,
  enabled: provider.enabled ?? true,
  id: ++rowSeq,
})

export const IpAssessmentSettings = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const [providers, setProviders] = useIpAssessmentProviders()
  const [rows, setRows] = useState(() => providers.map(toRow))

  const updateRow = (index: number, patch: Partial<IpAssessmentProvider>) =>
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    )

  const save = () => {
    const next = rows.map(({ type, url, key, enabled }) => ({
      type,
      url: url.trim(),
      key: key.trim(),
      enabled: enabled !== false,
    }))
    if (next.some((row) => row.enabled && !isHttpsAssessmentUrl(row.url))) {
      showNotice.error(t('home.network.settings.httpsRequired'))
      return
    }
    if (next.some((row) => row.enabled && row.type !== 'ipapi' && !row.key)) {
      showNotice.error(t('home.network.settings.keyRequired'))
      return
    }
    setProviders(next)
    try {
      if (
        localStorage.getItem('ip-assessment-providers') !== JSON.stringify(next)
      )
        throw new Error('Could not save API key')
      // The list now owns the key; drop the single-key setting it replaced.
      localStorage.removeItem('ip-assessment-api-key')
      onClose()
    } catch (err) {
      showNotice.error(err)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('home.network.settings.title')}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('home.network.settings.description')}
        </Alert>
        <Stack spacing={2}>
          {rows.map((row, index) => (
            <Stack
              key={row.id}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'flex-start' } }}
            >
              <Switch
                checked={row.enabled !== false}
                onChange={(_, enabled) => updateRow(index, { enabled })}
                slotProps={{
                  input: {
                    'aria-label': `${t('home.network.settings.enabled')} ${PROVIDER_LABELS[row.type]}`,
                  },
                }}
              />
              <TextField
                select
                size="small"
                label={t('home.network.settings.provider')}
                value={row.type}
                disabled={row.enabled === false}
                onChange={(event) => {
                  const type = event.target.value as IpAssessmentProviderType
                  updateRow(index, {
                    type,
                    // Follow the type unless the user typed a custom address.
                    ...(row.url === IP_ASSESSMENT_PROVIDER_URLS[row.type] && {
                      url: IP_ASSESSMENT_PROVIDER_URLS[type],
                    }),
                  })
                }}
                sx={{ minWidth: 130 }}
              >
                {(['ipapi', 'cleanip', 'ipinfo'] as const).map((type) => (
                  <MenuItem key={type} value={type}>
                    {PROVIDER_LABELS[type]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label={t('home.network.settings.url')}
                value={row.url}
                disabled={row.enabled === false}
                error={row.enabled !== false && !isHttpsAssessmentUrl(row.url)}
                helperText={
                  row.enabled !== false && !isHttpsAssessmentUrl(row.url)
                    ? t('home.network.settings.httpsRequired')
                    : undefined
                }
                onChange={(event) =>
                  updateRow(index, { url: event.target.value })
                }
                sx={{ flex: 1, minWidth: 0 }}
              />
              <TextField
                size="small"
                type="password"
                autoComplete="new-password"
                label={row.type === 'ipinfo' ? 'Token' : 'API Key'}
                value={row.key}
                disabled={row.enabled === false}
                error={
                  row.enabled !== false &&
                  row.type !== 'ipapi' &&
                  !row.key.trim()
                }
                helperText={
                  row.enabled !== false &&
                  row.type !== 'ipapi' &&
                  !row.key.trim()
                    ? t('home.network.settings.keyRequired')
                    : undefined
                }
                onChange={(event) =>
                  updateRow(index, { key: event.target.value })
                }
                sx={{ flex: 1, minWidth: 0 }}
              />
              <IconButton
                aria-label={t('home.network.settings.remove')}
                onClick={() =>
                  setRows((prev) => prev.filter((_, i) => i !== index))
                }
              >
                <DeleteOutlineRounded />
              </IconButton>
            </Stack>
          ))}
          {!rows.length && (
            <Typography variant="body2" color="text.secondary">
              {t('home.network.settings.empty')}
            </Typography>
          )}
          <Box>
            <Button
              startIcon={<AddRounded />}
              onClick={() =>
                setRows((prev) => [
                  ...prev,
                  toRow({
                    type: 'ipapi',
                    url: IP_ASSESSMENT_PROVIDER_URLS.ipapi,
                    key: '',
                    enabled: true,
                  }),
                ])
              }
            >
              {t('home.network.settings.add')}
            </Button>
          </Box>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('home.network.settings.privacy')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('shared.actions.cancel')}</Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={rows.some(
            (row) =>
              row.enabled !== false &&
              (!isHttpsAssessmentUrl(row.url) ||
                (row.type !== 'ipapi' && !row.key.trim())),
          )}
        >
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
