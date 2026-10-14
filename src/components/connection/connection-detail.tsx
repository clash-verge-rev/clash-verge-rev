import { Box, Button, Snackbar, useTheme } from '@mui/material'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import { useTranslation } from 'react-i18next'
import { closeConnection } from 'tauri-plugin-mihomo-api'

import { BaseDialog } from '@/components/base'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import parseTraffic from '@/utils/parse-traffic'

export interface ConnectionDetailRef {
  open: (detail: IConnectionsItem, closed: boolean) => void
  close: () => void
}

export function ConnectionDetail({ ref }: { ref?: Ref<ConnectionDetailRef> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<IConnectionsItem | null>(null)
  const [closed, setClosed] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const activeDetailRef = useRef<IConnectionsItem | null>(null)
  const theme = useTheme()

  const onClose = useCallback(() => {
    activeDetailRef.current = null
    setConfirmOpen(false)
    setOpen(false)
    setDetail(null)
    setClosed(false)
  }, [])

  useImperativeHandle(ref, () => ({
    open: (detail: IConnectionsItem, closed: boolean) => {
      if (open) return
      activeDetailRef.current = detail
      setOpen(true)
      setDetail(detail)
      setClosed(closed)
    },
    close: onClose,
  }))

  const onCancelClose = () => {
    if (!closing) setConfirmOpen(false)
  }

  const onConfirmClose = useLockFn(async () => {
    if (!detail) return
    const connection = detail
    setClosing(true)
    try {
      const result = await mutate(() => closeConnection(connection.id), {
        id: `close-connection:${connection.id}`,
        errorNotice: false,
      })
      if (result.ok && activeDetailRef.current === connection) onClose()
    } catch (error) {
      showNotice.error(error)
    } finally {
      setClosing(false)
    }
  })

  return (
    <Snackbar
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      open={open}
      onClose={() => {
        if (!confirmOpen && !closing) onClose()
      }}
      sx={{
        zIndex: confirmOpen ? theme.zIndex.modal - 1 : undefined,
        '.MuiSnackbarContent-root': {
          maxWidth: '520px',
          maxHeight: '480px',
          overflowY: 'auto',
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
        },
      }}
      message={
        detail ? (
          <>
            <InnerConnectionDetail
              data={detail}
              closed={closed}
              onRequestClose={() => setConfirmOpen(true)}
            />
            <BaseDialog
              open={confirmOpen}
              title={t('connections.components.actions.closeConnection')}
              okBtn={t('shared.actions.confirm')}
              cancelBtn={t('shared.actions.cancel')}
              loading={closing}
              disableCancel={closing}
              onOk={() => void onConfirmClose()}
              onCancel={onCancelClose}
              onClose={onCancelClose}
            >
              {t('connections.components.confirmClose')}
            </BaseDialog>
          </>
        ) : null
      }
    />
  )
}

interface InnerProps {
  data: IConnectionsItem
  closed: boolean
  onRequestClose: () => void
}

const InnerConnectionDetail = ({
  data,
  closed,
  onRequestClose,
}: InnerProps) => {
  const { t } = useTranslation()
  const { metadata, rulePayload } = data
  const theme = useTheme()
  const chains = [...data.chains].reverse().join(' / ')
  const rule = rulePayload ? `${data.rule}(${rulePayload})` : data.rule
  const hostAddress =
    metadata.host || metadata.destinationIP || metadata.remoteDestination
  const host = `${hostAddress}:${metadata.destinationPort}`
  const Destination = metadata.destinationIP
    ? metadata.destinationIP
    : metadata.remoteDestination

  const information = [
    { label: t('connections.components.fields.host'), value: host },
    {
      label: t('shared.labels.downloaded'),
      value: parseTraffic(data.download).join(' '),
    },
    {
      label: t('shared.labels.uploaded'),
      value: parseTraffic(data.upload).join(' '),
    },
    {
      label: t('connections.components.fields.dlSpeed'),
      value: parseTraffic(data.curDownload ?? -1).join(' ') + '/s',
    },
    {
      label: t('connections.components.fields.ulSpeed'),
      value: parseTraffic(data.curUpload ?? -1).join(' ') + '/s',
    },
    {
      label: t('connections.components.fields.chains'),
      value: chains,
    },
    { label: t('connections.components.fields.rule'), value: rule },
    {
      label: t('connections.components.fields.process'),
      value: `${metadata.process}${metadata.processPath ? `(${metadata.processPath})` : ''}`,
    },
    {
      label: t('connections.components.fields.time'),
      value: dayjs(data.start).fromNow(),
    },
    {
      label: t('connections.components.fields.source'),
      value: `${metadata.sourceIP}:${metadata.sourcePort}`,
    },
    {
      label: t('connections.components.fields.destination'),
      value: Destination,
    },
    {
      label: t('connections.components.fields.destinationPort'),
      value: `${metadata.destinationPort}`,
    },
    {
      label: t('connections.components.fields.type'),
      value: `${metadata.type}(${metadata.network})`,
    },
  ]

  return (
    <Box sx={{ userSelect: 'text', color: theme.palette.text.secondary }}>
      {information.map((each) => (
        <div key={each.label}>
          <b>{each.label}</b>
          <span
            style={{
              wordBreak: 'break-all',
              color: theme.palette.text.primary,
            }}
          >
            : {each.value}
          </span>
        </div>
      ))}

      {!closed && (
        <Box sx={{ textAlign: 'right' }}>
          <Button
            variant="contained"
            title={t('connections.components.actions.closeConnection')}
            onClick={onRequestClose}
          >
            {t('connections.components.actions.closeConnection')}
          </Button>
        </Box>
      )}
    </Box>
  )
}
