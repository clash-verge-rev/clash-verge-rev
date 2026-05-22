import { alpha, Box, Button, LinearProgress } from '@mui/material'
import { relaunch } from '@tauri-apps/plugin-process'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'

import { BaseDialog, DialogRef } from '@/components/base'
import { useUpdate } from '@/hooks/use-update'
import { portableFlag } from '@/pages/_layout'
import { showNotice } from '@/services/notice-service'
import { useSetUpdateState, useUpdateState } from '@/services/states'

type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  data?: {
    hProperties?: Record<string, unknown>
  }
}

const GITHUB_ALERTS = {
  note: { label: 'Note', color: '#0969da' },
  tip: { label: 'Tip', color: '#1a7f37' },
  important: { label: 'Important', color: '#8250df' },
  warning: { label: 'Warning', color: '#9a6700' },
  caution: { label: 'Caution', color: '#cf222e' },
} as const

type GitHubAlertType = keyof typeof GITHUB_ALERTS

const GITHUB_ALERT_PATTERN =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][\t ]*\n?/i
const GITHUB_ALERT_CLASS_PATTERN =
  /markdown-alert-(note|tip|important|warning|caution)/

const getAlertTypeFromClassName = (
  className: unknown,
): GitHubAlertType | null => {
  const value = Array.isArray(className)
    ? className.join(' ')
    : typeof className === 'string'
      ? className
      : ''
  const match = value.match(GITHUB_ALERT_CLASS_PATTERN)
  return match?.[1] as GitHubAlertType | null
}

const findFirstTextNode = (node: MarkdownNode): MarkdownNode | null => {
  if (node.type === 'text') return node
  for (const child of node.children ?? []) {
    const result = findFirstTextNode(child)
    if (result) return result
  }
  return null
}

const remarkGitHubAlerts = () => {
  const visit = (node: MarkdownNode) => {
    for (const child of node.children ?? []) {
      visit(child)
    }

    if (node.type !== 'blockquote') return

    const firstTextNode = findFirstTextNode(node)
    const match = firstTextNode?.value?.match(GITHUB_ALERT_PATTERN)
    if (!firstTextNode?.value || !match) return

    const alertType = match[1].toLowerCase() as GitHubAlertType
    firstTextNode.value = firstTextNode.value
      .replace(GITHUB_ALERT_PATTERN, '')
      .replace(/^\n+/, '')

    node.data = {
      ...(node.data ?? {}),
      hProperties: {
        ...(node.data?.hProperties ?? {}),
        className: ['markdown-alert', `markdown-alert-${alertType}`],
      },
    }

    node.children?.unshift({
      type: 'paragraph',
      data: {
        hProperties: {
          className: 'markdown-alert-title',
        },
      },
      children: [
        {
          type: 'text',
          value: GITHUB_ALERTS[alertType].label,
        },
      ],
    })
  }

  return visit
}

export function UpdateViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)
  const updateState = useUpdateState()
  const setUpdateState = useSetUpdateState()

  const { updateInfo } = useUpdate()

  const [downloaded, setDownloaded] = useState(0)
  const [total, setTotal] = useState(0)
  const downloadedRef = useRef(0)
  const totalRef = useRef(0)

  const progress = useMemo(() => {
    if (total <= 0) return 0
    return Math.min((downloaded / total) * 100, 100)
  }, [downloaded, total])

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const markdownContent = useMemo(() => {
    if (!updateInfo?.body) {
      return 'New Version is available'
    }
    return updateInfo?.body
  }, [updateInfo])

  const breakChangeFlag = useMemo(() => {
    if (!updateInfo?.body) {
      return false
    }
    return updateInfo?.body.toLowerCase().includes('break change')
  }, [updateInfo])

  const onUpdate = useLockFn(async () => {
    if (portableFlag) {
      showNotice.error('settings.modals.update.messages.portableError')
      return
    }
    if (!updateInfo?.body) return
    if (breakChangeFlag) {
      showNotice.error('settings.modals.update.messages.breakChangeError')
      return
    }
    if (updateState) return
    setUpdateState(true)
    setDownloaded(0)
    setTotal(0)
    downloadedRef.current = 0
    totalRef.current = 0

    const onDownloadEvent = (event: DownloadEvent) => {
      if (event.event === 'Started') {
        const contentLength = event.data.contentLength ?? 0
        totalRef.current = contentLength
        setTotal(contentLength)
        setDownloaded(0)
        downloadedRef.current = 0
        return
      }

      if (event.event === 'Progress') {
        setDownloaded((prev) => {
          const next = prev + event.data.chunkLength
          downloadedRef.current = next
          return next
        })
      }

      if (event.event === 'Finished' && totalRef.current === 0) {
        totalRef.current = downloadedRef.current
        setTotal(downloadedRef.current)
      }
    }

    try {
      await updateInfo.downloadAndInstall(onDownloadEvent)
      await relaunch()
    } catch (err: any) {
      showNotice.error(err)
    } finally {
      setUpdateState(false)
      setDownloaded(0)
      setTotal(0)
      downloadedRef.current = 0
      totalRef.current = 0
    }
  })

  return (
    <BaseDialog
      open={open}
      title={
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            minWidth: 0,
          }}
        >
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t('settings.modals.update.title', {
              version: updateInfo?.version ?? '',
            })}
          </Box>
          <Button
            variant="contained"
            size="small"
            sx={{ whiteSpace: 'nowrap' }}
            onClick={() => {
              openUrl(
                `https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/v${updateInfo?.version}`,
              )
            }}
          >
            {t('settings.modals.update.actions.goToRelease')}
          </Button>
        </Box>
      }
      contentSx={{
        width: { xs: 'calc(100vw - 56px)', sm: 560 },
        maxWidth: 'calc(100vw - 56px)',
        height: 'min(64vh, 680px)',
        display: 'flex',
        flexDirection: 'column',
        pb: 1,
      }}
      okBtn={t('settings.modals.update.actions.update')}
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onUpdate}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          pr: 1.5,
          mr: -1,
          fontSize: 14,
          lineHeight: 1.65,
          color: 'text.primary',
          overflowWrap: 'break-word',
          '& > :first-child': {
            mt: 0,
          },
          '& > :last-child': {
            mb: 0,
          },
          '& h1': {
            mt: 0,
            mb: 1.5,
            fontSize: 24,
            lineHeight: 1.25,
          },
          '& h2': {
            mt: 2.25,
            mb: 1,
            fontSize: 19,
            lineHeight: 1.3,
          },
          '& h3': {
            mt: 2,
            mb: 0.75,
            fontSize: 16,
            lineHeight: 1.35,
          },
          '& h4, & h5, & h6': {
            mt: 1.5,
            mb: 0.75,
            fontSize: 14,
            lineHeight: 1.4,
          },
          '& p': {
            my: 1,
          },
          '& ul, & ol': {
            my: 1,
            pl: 2.75,
          },
          '& li': {
            my: 0.35,
            pl: 0.25,
          },
          '& a': {
            color: 'primary.main',
            overflowWrap: 'anywhere',
          },
          '& strong': {
            fontWeight: 700,
          },
          '& code': {
            px: 0.5,
            py: 0.125,
            borderRadius: 0.5,
            bgcolor: 'action.hover',
            fontSize: '0.92em',
          },
          '& pre': {
            my: 1.5,
            p: 1.5,
            overflow: 'auto',
            borderRadius: 1,
            bgcolor: 'action.hover',
          },
          '& pre code': {
            p: 0,
            bgcolor: 'transparent',
            fontSize: '0.9em',
          },
          '& table': {
            display: 'block',
            width: '100%',
            my: 1.5,
            overflowX: 'auto',
            borderCollapse: 'collapse',
          },
          '& th, & td': {
            px: 1,
            py: 0.75,
            border: '1px solid',
            borderColor: 'divider',
            verticalAlign: 'top',
          },
          '& th': {
            bgcolor: 'action.hover',
            fontWeight: 700,
          },
          '& hr': {
            my: 2,
            border: 0,
            borderTop: '1px solid',
            borderColor: 'divider',
          },
          '& img': {
            maxWidth: '100%',
            height: 'auto',
            borderRadius: 1,
          },
          '& blockquote:not(.markdown-alert)': {
            m: '12px 0 18px',
            pl: 2,
            color: 'text.secondary',
            borderLeft: '4px solid',
            borderColor: 'divider',
          },
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGitHubAlerts]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ ...props }) => {
              const { children } = props
              return (
                <a {...props} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            },
            blockquote: ({ className, children }) => {
              const alertType = getAlertTypeFromClassName(className)

              if (!alertType) {
                return <blockquote className={className}>{children}</blockquote>
              }

              return (
                <Box
                  component="blockquote"
                  className={className}
                  sx={(theme) => {
                    const color = GITHUB_ALERTS[alertType].color
                    return {
                      m: '12px 0 18px',
                      px: 2,
                      py: 1,
                      borderLeft: `4px solid ${color}`,
                      borderRadius: 1,
                      bgcolor: alpha(
                        color,
                        theme.palette.mode === 'dark' ? 0.16 : 0.08,
                      ),
                      '& p': {
                        my: 0.75,
                      },
                      '& .markdown-alert-title': {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        fontWeight: 700,
                        lineHeight: 1.4,
                      },
                    }
                  }}
                >
                  {children}
                </Box>
              )
            },
          }}
        >
          {markdownContent}
        </ReactMarkdown>
      </Box>
      {updateState && (
        <LinearProgress
          variant={total > 0 ? 'determinate' : 'indeterminate'}
          value={progress}
          sx={{ mt: 1 }}
        />
      )}
    </BaseDialog>
  )
}
