import { ContentCopyRounded, ReplayRounded } from '@mui/icons-material'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

import type { CaptureFlow } from '@/services/capture'

import { CaptureBodyInspector } from './capture-body-inspector'

interface Props {
  flow: CaptureFlow | null
  onClose: () => void
  onCopy: (id: string) => void
  onReplay: (flow: CaptureFlow) => void
  replaying: boolean
}

export const CaptureFlowDetail = ({
  flow,
  onClose,
  onCopy,
  onReplay,
  replaying,
}: Props) => {
  const { t } = useTranslation()
  const placeholder = flow?.error || t('layout.capture.waiting')

  return (
    <Dialog
      open={Boolean(flow)}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      slotProps={{ paper: { sx: { height: 'min(80vh, 860px)' } } }}
    >
      <DialogTitle>{t('layout.capture.detailTitle')}</DialogTitle>
      <DialogContent dividers>
        {flow && (
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
              {flow.method} {flow.url}
            </Typography>
            <CaptureBodyInspector
              title={t('layout.capture.request')}
              url={flow.url}
              body={flow.request}
              request
              placeholder={placeholder}
            />
            <CaptureBodyInspector
              title={t('layout.capture.response')}
              url={flow.url}
              body={flow.response}
              request={false}
              placeholder={placeholder}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {flow?.request && (
          <Button
            disabled={replaying}
            startIcon={<ReplayRounded />}
            onClick={() => onReplay(flow)}
          >
            {t('layout.capture.replay')}
          </Button>
        )}
        {flow?.request && (
          <Button
            startIcon={<ContentCopyRounded />}
            onClick={() => onCopy(flow.id)}
          >
            {t('layout.capture.copyCurl')}
          </Button>
        )}
        <Button onClick={onClose}>{t('layout.capture.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
