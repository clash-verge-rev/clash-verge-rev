import { AddRounded } from '@mui/icons-material'
import { Box, Button, Chip, Collapse, Stack, Typography } from '@mui/material'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseStyledTextField, Switch } from '@/components/base'
import type { CaptureSettings } from '@/services/capture'

import { CaptureCard } from './capture-card'

interface Props {
  settings: CaptureSettings
  onCaptureChange: (
    patch: Partial<Pick<CaptureSettings, 'enabled' | 'capture_all'>>,
  ) => void
  onAddRule: (url: string) => void
  onRemoveRule: (id: number) => void
}

export const CaptureFilterCard = ({
  settings,
  onCaptureChange,
  onAddRule,
  onRemoveRule,
}: Props) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  const { enabled, capture_all: captureAll, rules } = settings
  const showRules = enabled && !captureAll && rules.length > 0

  const summary = !enabled
    ? t('layout.capture.stateOff')
    : captureAll
      ? t('layout.capture.stateAll')
      : rules.length
        ? t('layout.capture.stateRules')
        : t('layout.capture.stateNone')

  const submitRule = (event: FormEvent) => {
    event.preventDefault()
    const value = url.trim()
    if (!value) return
    onAddRule(value)
    setUrl('')
  }

  return (
    <CaptureCard>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
            {summary}
          </Typography>
          {showRules && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
              {rules.map((rule) => (
                <Chip
                  key={rule.id}
                  size="small"
                  label={rule.url}
                  onDelete={open ? () => onRemoveRule(rule.id) : undefined}
                />
              ))}
            </Stack>
          )}
        </Stack>
        <Button size="small" onClick={() => setOpen(!open)}>
          {open ? t('layout.capture.collapse') : t('layout.capture.edit')}
        </Button>
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Stack spacing={1.5} sx={{ mt: open ? 2 : 0 }}>
          {[
            {
              checked: enabled,
              label: t('layout.capture.enable'),
              hint: t('layout.capture.enableHint'),
              onChange: (checked: boolean) =>
                onCaptureChange({ enabled: checked }),
            },
            {
              checked: captureAll,
              label: t('layout.capture.captureAll'),
              hint: t('layout.capture.captureAllHint'),
              onChange: (checked: boolean) =>
                onCaptureChange({ capture_all: checked }),
            },
          ].map(({ checked, label, hint, onChange }) => (
            <Stack
              key={label}
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center' }}
            >
              <Switch
                checked={checked}
                onChange={(_, value) => onChange(value)}
              />
              <Stack sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {hint}
                </Typography>
              </Stack>
            </Stack>
          ))}

          <Typography variant="caption" color="text.secondary">
            {t('layout.capture.ruleHint')}
          </Typography>

          <Box
            component="form"
            sx={{ display: 'flex', gap: 1 }}
            onSubmit={submitRule}
          >
            <BaseStyledTextField
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder={t('layout.capture.rulePlaceholder')}
              aria-label={t('layout.capture.ruleLabel')}
              slotProps={{
                input: { spellCheck: false, autoCapitalize: 'none' },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              startIcon={<AddRounded />}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {t('layout.capture.add')}
            </Button>
          </Box>
        </Stack>
      </Collapse>
    </CaptureCard>
  )
}
