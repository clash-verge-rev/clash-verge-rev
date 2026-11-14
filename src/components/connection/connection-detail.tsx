import { Box, Button, Snackbar, useTheme } from '@mui/material'
import { useLockFn } from 'ahooks'
import dayjs from 'dayjs'
import { useCallback, useImperativeHandle, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { closeConnection } from 'tauri-plugin-mihomo-api'

import { useProfiles } from '@/hooks/use-profiles'
import parseTraffic from '@/utils/parse-traffic'

import { getConnectionRuleTargets } from './connection-rule'
import {
  ConnectionRuleDialog,
  type ConnectionRuleTarget,
} from './connection-rule-dialog'

export interface ConnectionDetailRef {
  open: (detail: IConnectionsItem, closed: boolean) => void
  close: () => void
}

export function ConnectionDetail({ ref }: { ref?: Ref<ConnectionDetailRef> }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<IConnectionsItem | null>(null)
  const [closed, setClosed] = useState(false)
  const theme = useTheme()
  const [ruleTarget, setRuleTarget] = useState<ConnectionRuleTarget | null>(
    null,
  )

  const onClose = useCallback(() => {
    setOpen(false)
    setDetail(null)
    setClosed(false)
  }, [])

  useImperativeHandle(ref, () => ({
    open: (detail: IConnectionsItem, closed: boolean) => {
      if (open) return
      setOpen(true)
      setDetail(detail)
      setClosed(closed)
    },
    close: onClose,
  }))

  return (
    <>
      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        open={open}
        onClose={onClose}
        sx={{
          '.MuiSnackbarContent-root': {
            width: '520px',
            maxWidth: 'calc(100vw - 32px)',
            boxSizing: 'border-box',
            maxHeight: '480px',
            overflowY: 'auto',
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
          },
          '.MuiSnackbarContent-message': { width: '100%', minWidth: 0 },
        }}
        message={
          detail ? (
            <InnerConnectionDetail
              data={detail}
              closed={closed}
              onClose={onClose}
              onAddRule={(target) => {
                setRuleTarget(target)
                onClose()
              }}
            />
          ) : null
        }
      />
      {ruleTarget && (
        <ConnectionRuleDialog
          target={ruleTarget}
          onClose={() => setRuleTarget(null)}
        />
      )}
    </>
  )
}

interface InnerProps {
  data: IConnectionsItem
  closed: boolean
  onClose?: () => void
  onAddRule: (target: ConnectionRuleTarget) => void
}

const InnerConnectionDetail = ({
  data,
  closed,
  onClose,
  onAddRule,
}: InnerProps) => {
  const { t } = useTranslation()
  const { current } = useProfiles()
  const { metadata, rulePayload } = data
  const targets = getConnectionRuleTargets(metadata)
  const canAddRule = Boolean(
    current?.uid &&
      current.option?.rules &&
      (targets.domain || targets.process),
  )
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
      value: `${metadata.process ?? ''}${metadata.processPath ? `(${metadata.processPath})` : ''}`,
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

  const onDelete = useLockFn(async () => closeConnection(data.id))

  return (
    <Box
      sx={{
        width: '100%',
        minWidth: 0,
        userSelect: 'text',
        color: theme.palette.text.secondary,
      }}
    >
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

      <Box
        sx={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
          flexWrap: 'wrap',
          mt: 1,
        }}
      >
        <Button
          variant="outlined"
          disabled={!canAddRule}
          onClick={() => {
            if (!current?.uid || !current.option?.rules) return
            onAddRule({
              metadata: { ...metadata },
              profileUid: current.uid,
              profileName: current.name || current.uid,
              rulesUid: current.option.rules,
            })
          }}
        >
          {t('connections.ruleDialog.entry')}
        </Button>
        {!closed && (
          <Button
            variant="contained"
            title={t('connections.components.actions.closeConnection')}
            onClick={() => {
              onDelete()
              onClose?.()
            }}
          >
            {t('connections.components.actions.closeConnection')}
          </Button>
        )}
      </Box>
      {!canAddRule && (
        <Box sx={{ mt: 1, typography: 'caption' }}>
          {t(
            targets.domain || targets.process
              ? 'connections.ruleDialog.noProfile'
              : 'connections.ruleDialog.noMetadata',
          )}
        </Box>
      )}
    </Box>
  )
}
