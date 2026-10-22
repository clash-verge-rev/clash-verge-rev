import { ContentCopyRounded } from '@mui/icons-material'
import { alpha, Box, Button, CircularProgress, IconButton } from '@mui/material'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { Ref } from 'react'
import { useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, BaseEmpty, DialogRef } from '@/components/base'
import { useNetworkInterfaces } from '@/hooks/use-network'
import { showNotice } from '@/services/notice-service'

export function NetworkInterfaceViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [isV4, setIsV4] = useState(true)

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  const { networkInterfaces, loading } = useNetworkInterfaces()
  const isEmpty = networkInterfaces.length === 0
  const getAddressIp = (address: IAddress) =>
    isV4 ? address.V4?.ip : address.V6?.ip

  return (
    <BaseDialog
      open={open}
      title={
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          {t('settings.modals.networkInterface.title')}
          <Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                setIsV4((prev) => !prev)
              }}
            >
              {isV4 ? 'Ipv6' : 'Ipv4'}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{ width: 450 }}
      disableOk
      cancelBtn={t('shared.actions.close')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      {loading && isEmpty ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      ) : isEmpty ? (
        <Box sx={{ minHeight: 160 }}>
          <BaseEmpty />
        </Box>
      ) : (
        networkInterfaces.map((item) => (
          <Box key={item.name}>
            <h4>{item.name}</h4>
            <Box>
              {item.addr.map((address) => {
                const ip = getAddressIp(address)
                return (
                  ip && (
                    <AddressDisplay
                      key={ip}
                      label={t(
                        'settings.modals.networkInterface.fields.ipAddress',
                      )}
                      content={ip}
                    />
                  )
                )
              })}
              <AddressDisplay
                label={t('settings.modals.networkInterface.fields.macAddress')}
                content={item.mac_addr ?? ''}
              />
            </Box>
          </Box>
        ))
      )}
    </BaseDialog>
  )
}

const AddressDisplay = ({
  label,
  content,
}: {
  label: string
  content: string
}) => {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        margin: '8px 0',
      }}
    >
      <Box>{label}</Box>
      <Box
        sx={({ palette }) => ({
          borderRadius: '8px',
          padding: '2px 2px 2px 8px',
          background:
            palette.mode === 'dark'
              ? alpha(palette.background.paper, 0.3)
              : alpha(palette.grey[400], 0.3),
        })}
      >
        <Box sx={{ display: 'inline', userSelect: 'text' }}>{content}</Box>
        <IconButton
          size="small"
          onClick={async () => {
            await writeText(content)
            showNotice.success(
              'shared.feedback.notifications.common.copySuccess',
            )
          }}
        >
          <ContentCopyRounded sx={{ fontSize: '18px' }} />
        </IconButton>
      </Box>
    </Box>
  )
}
