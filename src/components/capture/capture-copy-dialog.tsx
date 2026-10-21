import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  command: string | null
  title?: string
  onClose: () => void
}

export const CaptureCopyDialog = ({ command, title, onClose }: Props) => {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  return (
    <Dialog open={Boolean(command)} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{title ?? t('layout.capture.copyDialogTitle')}</DialogTitle>
      <DialogContent dividers>
        <TextField
          inputRef={inputRef}
          multiline
          fullWidth
          minRows={8}
          value={command ?? ''}
          slotProps={{
            input: {
              readOnly: true,
              spellCheck: false,
              sx: { fontFamily: 'monospace', fontSize: 12 },
            },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            inputRef.current?.focus()
            inputRef.current?.select()
          }}
        >
          {t('layout.capture.selectAll')}
        </Button>
        <Button onClick={onClose}>{t('layout.capture.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
