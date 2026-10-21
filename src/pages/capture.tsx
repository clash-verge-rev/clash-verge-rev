import { ContentCopyRounded, DownloadRounded } from '@mui/icons-material'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
  TextField,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import { CaptureBodyInspector } from '@/components/capture/capture-body-inspector'
import { CaptureCard } from '@/components/capture/capture-card'
import { CaptureCopyDialog } from '@/components/capture/capture-copy-dialog'
import { CaptureFilterCard } from '@/components/capture/capture-filter-card'
import { CaptureFlowDetail } from '@/components/capture/capture-flow-detail'
import { CaptureFlowTable } from '@/components/capture/capture-flow-table'
import { useCaptureSession } from '@/hooks/use-capture-session'
import { useVerge } from '@/hooks/use-verge'
import {
  exportCaptureCertificate,
  getCaptureFlow,
  replayCaptureFlow,
  type CaptureFlow,
  type ReplayResult,
} from '@/services/capture'
import { mutate } from '@/services/mutate'
import { toCurl } from '@/utils/capture-curl'

interface ClearTarget {
  domain: string
  count: number
}

export default function CapturePage() {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const {
    status,
    settings,
    flows,
    domains,
    query,
    busy,
    error,
    setQuery,
    toggle,
    setCapturing,
    addRule,
    removeRule,
    countFlows,
    clearFlows,
  } = useCaptureSession()

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaptureFlow | null>(null)
  const [copyCommand, setCopyCommand] = useState<string | null>(null)
  const [clearTarget, setClearTarget] = useState<ClearTarget | null>(null)
  const [replayTarget, setReplayTarget] = useState<CaptureFlow | null>(null)
  const [replayQuery, setReplayQuery] = useState('')
  const [replayBody, setReplayBody] = useState('')
  const [originalReplayBody, setOriginalReplayBody] = useState('')
  const [bodyEditable, setBodyEditable] = useState(true)
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null)
  const [copyTitle, setCopyTitle] = useState<string | undefined>()
  const [replaying, setReplaying] = useState(false)
  const [replayError, setReplayError] = useState('')
  const [notice, setNotice] = useState('')
  const [certMessage, setCertMessage] = useState<{
    severity: 'success' | 'error'
    text: string
  } | null>(null)

  const running = Boolean(status?.running)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 10000)
    return () => clearTimeout(timer)
  }, [notice])

  const exportCert = async () => {
    try {
      const result = await mutate(exportCaptureCertificate, {
        id: 'capture-certificate',
        errorNotice: false,
      })
      const path = result.value
      if (path) {
        setCertMessage({
          severity: 'success',
          text: t('layout.capture.certExported', { path }),
        })
      }
    } catch (certError) {
      const message = String(certError)
      setCertMessage({
        severity: 'error',
        text: message.includes('not generated')
          ? t('layout.capture.certMissing')
          : message,
      })
    }
  }

  useEffect(() => {
    if (!detailId || !running) return
    // Bodies can finish after the row appears; keep the selected flow live.
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const flow = await getCaptureFlow(detailId)
        if (!disposed) setDetail(flow)
      } catch (detailError) {
        if (!disposed) setNotice(String(detailError))
      } finally {
        if (!disposed) timer = setTimeout(() => void refresh(), 2000)
      }
    }
    void refresh()
    return () => {
      // Closing or switching flows also invalidates a response already in flight.
      disposed = true
      clearTimeout(timer)
    }
  }, [detailId, running])

  const closeDetail = () => {
    setDetailId(null)
    setDetail(null)
  }

  const openDetail = (id: string) => {
    setDetail(null)
    setDetailId(id)
    setNotice('')
  }

  const copyCurl = async (id: string) => {
    try {
      const flow = await getCaptureFlow(id)
      setCopyTitle(undefined)
      const command = toCurl(flow)
      try {
        await navigator.clipboard.writeText(command)
        setNotice(t('layout.capture.copied'))
      } catch {
        setCopyCommand(command)
      }
    } catch (copyError) {
      const reason = copyError instanceof Error ? copyError.message : ''
      setNotice(
        reason === 'curlNotRecorded' || reason === 'curlTruncated'
          ? t(`layout.capture.${reason}`)
          : String(copyError),
      )
    }
  }

  const openReplay = (flow: CaptureFlow) => {
    setReplayTarget(flow)
    setReplayQuery(new URL(flow.url).search.slice(1))
    setReplayResult(null)
    setReplayError('')
    let text = flow.request?.body ?? ''
    let editable = true
    if (flow.request?.encoding === 'base64') {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(atob(text), (c) => c.charCodeAt(0)),
        )
      } catch {
        text = ''
        editable = false
      }
    }
    setBodyEditable(editable)
    setReplayBody(text)
    setOriginalReplayBody(text)
  }

  const copyAddress = async () => {
    const address = `127.0.0.1:${status?.proxy_port ?? 17891}`
    try {
      await navigator.clipboard.writeText(address)
      setNotice(t('layout.capture.contentCopied'))
    } catch {
      setCopyTitle(t('layout.capture.proxyAddress'))
      setCopyCommand(address)
    }
  }

  const confirmReplay = async () => {
    if (!replayTarget || replaying) return
    const target = replayTarget
    setReplaying(true)
    setReplayError('')
    setReplayResult(null)
    try {
      const result = await mutate(
        () =>
          replayCaptureFlow(
            target.id,
            replayQuery,
            bodyEditable && replayBody !== originalReplayBody
              ? replayBody
              : undefined,
          ),
        {
          id: 'capture-replay',
          errorNotice: false,
        },
      )
      if (result.ok) setReplayResult(result.value)
    } catch (error) {
      const reason = String(error)
      setReplayError(
        reason === 'replayIncomplete' || reason === 'replayUnsupported'
          ? t(`layout.capture.${reason}`)
          : reason,
      )
    } finally {
      setReplaying(false)
    }
  }

  const requestClear = async (domain: string) => {
    const info = await countFlows(domain)
    if (!info?.count) {
      setNotice(t('layout.capture.nothingToClear'))
      return
    }
    setClearTarget({ domain, count: info.count })
  }

  const confirmClear = async () => {
    const target = clearTarget
    setClearTarget(null)
    if (!target) return
    const result = await clearFlows(target.domain)
    if (result) {
      closeDetail()
      setNotice(t('layout.capture.cleared', { count: result.deleted }))
    }
  }

  const clearScope = clearTarget
    ? clearTarget.domain
      ? t('layout.capture.scopeDomain', { domain: clearTarget.domain })
      : t('layout.capture.scopeAll')
    : ''

  return (
    <BasePage title={t('layout.components.navigation.tabs.capture')} full>
      <Stack
        spacing={2}
        sx={{ p: 2, height: 'calc(100vh - 90px)', overflow: 'auto' }}
      >
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Button
            variant="contained"
            color={running ? 'error' : 'success'}
            disabled={busy}
            onClick={() => void toggle()}
          >
            {running ? t('layout.capture.stop') : t('layout.capture.start')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadRounded />}
            onClick={() => void exportCert()}
          >
            {t('layout.capture.downloadCert')}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {t('layout.capture.route')}
          </Typography>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="body2">
            HTTP / SOCKS5: 127.0.0.1:{status?.proxy_port ?? 17891}
          </Typography>
          <Button
            size="small"
            startIcon={<ContentCopyRounded />}
            onClick={() => void copyAddress()}
          >
            {t('layout.capture.proxyAddress')}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t(
              verge?.enable_system_proxy
                ? 'layout.capture.proxyAuto'
                : 'layout.capture.proxyManual',
            )}
          </Typography>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {replayError && <Alert severity="error">{replayError}</Alert>}
        {notice && <Alert severity="success">{notice}</Alert>}
        {certMessage && (
          <Alert
            severity={certMessage.severity}
            onClose={() => setCertMessage(null)}
          >
            {certMessage.text}
          </Alert>
        )}

        {!running && (
          <Alert severity="info">
            {t('layout.capture.instructions')} {t('layout.capture.certHint')}
          </Alert>
        )}

        {running && settings && (
          <CaptureFilterCard
            settings={settings}
            onCaptureChange={(patch) => void setCapturing(patch)}
            onAddRule={(url) => void addRule(url)}
            onRemoveRule={(id) => void removeRule(id)}
          />
        )}

        {running && flows && (
          <CaptureFlowTable
            flows={flows}
            domains={domains}
            query={query}
            onQueryChange={(next) => setQuery((prev) => ({ ...prev, ...next }))}
            onOpen={openDetail}
            onCopy={(id) => void copyCurl(id)}
            onClear={(domain) => void requestClear(domain)}
          />
        )}

        {running && !flows && (
          <CaptureCard>{t('layout.capture.noResults')}</CaptureCard>
        )}
      </Stack>

      <CaptureFlowDetail
        flow={running ? detail : null}
        onClose={closeDetail}
        onCopy={(id) => void copyCurl(id)}
        onReplay={openReplay}
        replaying={replaying}
      />
      <CaptureCopyDialog
        command={copyCommand}
        title={copyTitle}
        onClose={() => setCopyCommand(null)}
      />

      <Dialog
        open={Boolean(replayTarget)}
        onClose={() => {
          if (!replaying) setReplayTarget(null)
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle>{t('layout.capture.replayTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <DialogContentText>
              {t('layout.capture.replayWarning')}
            </DialogContentText>
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
              {replayTarget?.method} {replayTarget?.url}
            </Typography>
            <TextField
              label={t('layout.capture.replayParams')}
              value={replayQuery}
              disabled={replaying}
              onChange={(event) => setReplayQuery(event.target.value)}
              fullWidth
              multiline
              slotProps={{ input: { spellCheck: false } }}
            />
            <TextField
              label="Body"
              value={replayBody}
              disabled={replaying || !bodyEditable}
              onChange={(event) => setReplayBody(event.target.value)}
              fullWidth
              multiline
              minRows={4}
              maxRows={12}
              helperText={
                !bodyEditable ? t('layout.capture.replayBinary') : undefined
              }
              slotProps={{
                input: { spellCheck: false, sx: { fontFamily: 'monospace' } },
              }}
            />
            {replayError && <Alert severity="error">{replayError}</Alert>}
            {replayResult && (
              <>
                <Alert
                  severity={replayResult.status >= 400 ? 'warning' : 'success'}
                >
                  HTTP {replayResult.status}
                </Alert>
                <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                  {replayResult.url}
                </Typography>
                <CaptureBodyInspector
                  title={t('layout.capture.response')}
                  url={replayResult.url}
                  body={replayResult.response}
                  request={false}
                  placeholder=""
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={replaying} onClick={() => setReplayTarget(null)}>
            {t('layout.capture.close')}
          </Button>
          <Button
            variant="contained"
            disabled={replaying || !running}
            onClick={() => void confirmReplay()}
          >
            {t('layout.capture.replay')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(clearTarget)} onClose={() => setClearTarget(null)}>
        <DialogTitle>{t('layout.capture.clearConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('layout.capture.clearConfirmBody', {
              scope: clearScope,
              count: clearTarget?.count ?? 0,
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearTarget(null)}>
            {t('layout.capture.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void confirmClear()}
          >
            {t('layout.capture.confirmClear')}
          </Button>
        </DialogActions>
      </Dialog>
    </BasePage>
  )
}
