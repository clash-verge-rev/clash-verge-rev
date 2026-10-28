import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'
import {
  TEST_PRESETS,
  applyTestPresetSelection,
  isTestPresetEnabled,
} from '@/utils/test-presets'

interface Props {
  testList: IVergeTestItem[]
  onClose: () => void
}

export const TestPresetsDialog = ({ testList, onClose }: Props) => {
  const { t } = useTranslation()
  const { patchVerge } = useVerge()
  const [selected, setSelected] = useState(() =>
    TEST_PRESETS.filter((preset) => isTestPresetEnabled(testList, preset)).map(
      (preset) => preset.uid,
    ),
  )
  const [saving, setSaving] = useState(false)

  const handleSave = useLockFn(async () => {
    setSaving(true)
    try {
      await patchVerge({
        test_list: applyTestPresetSelection(testList, selected),
      })
      onClose()
    } catch (error) {
      showNotice.error(error)
    } finally {
      setSaving(false)
    }
  })

  return (
    <Dialog
      open
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="test-presets-title"
    >
      <DialogTitle id="test-presets-title">
        {t('tests.presets.title')}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('tests.presets.description')}
        </Typography>
        <Stack>
          {TEST_PRESETS.map((preset) => (
            <FormControlLabel
              key={preset.uid}
              labelPlacement="start"
              disabled={saving}
              sx={{
                m: 0,
                py: 1,
                gap: 2,
                justifyContent: 'space-between',
                borderBottom: 1,
                borderColor: 'divider',
                '&:last-child': { borderBottom: 0 },
              }}
              control={
                <Switch
                  checked={selected.includes(preset.uid)}
                  onChange={(_, checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, preset.uid]
                        : current.filter((uid) => uid !== preset.uid),
                    )
                  }
                  slotProps={{ input: { 'aria-label': preset.name } }}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Avatar
                    variant="rounded"
                    src={
                      preset.icon.startsWith('<svg')
                        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preset.icon)}`
                        : preset.icon
                    }
                    sx={{
                      width: 36,
                      height: 36,
                      bgcolor: 'action.hover',
                      color: 'text.secondary',
                      '& img': {
                        objectFit: 'contain',
                        p: 0.5,
                        boxSizing: 'border-box',
                      },
                    }}
                  >
                    {preset.name.charAt(0)}
                  </Avatar>
                  <Typography>{preset.name}</Typography>
                </Box>
              }
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('shared.actions.cancel')}
        </Button>
        <Button onClick={handleSave} loading={saving}>
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
