import { Box, Dialog, DialogContent, DialogTitle } from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  value: string
  title?: string
  onClose: () => void
}

export const QrViewer = (props: Props) => {
  const { open, value, title, onClose } = props
  const { t } = useTranslation()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs">
      <DialogTitle>{title ?? t('profiles.modals.qrViewer.title')}</DialogTitle>
      <DialogContent sx={{ pb: 3 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            p: 2,
            bgcolor: '#fff',
            borderRadius: 1,
          }}
        >
          <QRCodeSVG value={value} size={256} level="M" />
        </Box>
      </DialogContent>
    </Dialog>
  )
}
