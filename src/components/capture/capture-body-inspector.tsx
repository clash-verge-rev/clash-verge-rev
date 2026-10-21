import { ContentCopyRounded } from '@mui/icons-material'
import {
  Box,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { CaptureBody } from '@/services/capture'
import { formatHeaders } from '@/utils/capture-curl'
import {
  cookiePairs,
  decodeBody,
  headerPairs,
  prettyJson,
  queryPairs,
  type KeyValue,
} from '@/utils/capture-inspectors'

import { CaptureCopyDialog } from './capture-copy-dialog'

interface Props {
  title: string
  url: string
  body: CaptureBody | null
  request: boolean
  placeholder: string
}

const KeyValueTable = ({ rows }: { rows: KeyValue[] }) => (
  <Box
    component="table"
    sx={{
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12,
      fontFamily: 'monospace',
      '& td': { p: 0.5, verticalAlign: 'top', wordBreak: 'break-all' },
      '& td:first-of-type': {
        width: '32%',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      },
    }}
  >
    <tbody>
      {rows.map(({ name, value }) => (
        <tr key={name}>
          <td>{name}</td>
          <td>{value || '—'}</td>
        </tr>
      ))}
    </tbody>
  </Box>
)

const Pre = ({ children }: { children: ReactNode }) => (
  <Typography
    component="pre"
    sx={{
      m: 0,
      fontSize: 12,
      lineHeight: 1.6,
      fontFamily: 'monospace',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }}
  >
    {children}
  </Typography>
)

interface InspectorTab {
  key: string
  label: string
  content: ReactNode
  copyValue: string
}

/** Fiddler-style inspectors: Headers / Query String / Cookies / Text / JSON / Raw. */
export const CaptureBodyInspector = ({
  title,
  url,
  body,
  request,
  placeholder,
}: Props) => {
  const { t } = useTranslation()
  const [tab, setTab] = useState('headers')
  const [copyText, setCopyText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const tabs = useMemo<InspectorTab[]>(() => {
    if (!body) return []
    const text = decodeBody(body)
    const json = prettyJson(text)
    const queries = request ? queryPairs(url) : []
    const cookies = cookiePairs(body, request)

    const list: InspectorTab[] = [
      {
        key: 'headers',
        label: t('layout.capture.tab_headers'),
        content: <KeyValueTable rows={headerPairs(body)} />,
        copyValue: formatHeaders(body),
      },
    ]
    if (queries.length) {
      list.push({
        key: 'query',
        label: t('layout.capture.tab_query'),
        content: <KeyValueTable rows={queries} />,
        copyValue: queries
          .map(({ name, value }) => `${name}: ${value}`)
          .join('\n'),
      })
    }
    if (cookies.length) {
      list.push({
        key: 'cookies',
        label: t('layout.capture.tab_cookies'),
        content: <KeyValueTable rows={cookies} />,
        copyValue: cookies
          .map(({ name, value }) => `${name}=${value}`)
          .join('; '),
      })
    }
    if (json) {
      list.push({
        key: 'json',
        label: t('layout.capture.tab_json'),
        content: <Pre>{json}</Pre>,
        copyValue: json,
      })
    } else if (text) {
      list.push({
        key: 'text',
        label: t('layout.capture.tab_text'),
        content: <Pre>{text}</Pre>,
        copyValue: text,
      })
    }
    list.push({
      key: 'raw',
      label: t('layout.capture.tab_raw'),
      content: <Pre>{`${formatHeaders(body)}\n\n${text}`}</Pre>,
      copyValue: `${formatHeaders(body)}\n\n${text}`,
    })
    return list
  }, [body, request, t, url])

  const active = tabs.some(({ key }) => key === tab) ? tab : 'headers'
  const current = tabs.find(({ key }) => key === active)

  const copyCurrent = async () => {
    if (!current) return
    // Snapshot the selected tab before awaiting clipboard access or opening fallback UI.
    const value = current.copyValue
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopyText(value)
    }
  }

  return (
    <Stack spacing={0.5} sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2">{title}</Typography>
      {body?.truncated && (
        <Typography variant="caption" color="warning.main">
          {t('layout.capture.bodyTruncated')}
        </Typography>
      )}
      <Box
        sx={{
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'action.hover',
        }}
      >
        {body ? (
          <>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Tabs
                value={active}
                onChange={(_, value: string) => {
                  setTab(value)
                  setCopied(false)
                }}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                  minHeight: 34,
                  flex: 1,
                  minWidth: 0,
                  '& .MuiTab-root': {
                    minHeight: 34,
                    py: 0.5,
                    textTransform: 'none',
                    fontSize: 12,
                  },
                }}
              >
                {tabs.map(({ key, label }) => (
                  <Tab key={key} value={key} label={label} />
                ))}
              </Tabs>
              <Tooltip
                title={
                  copied
                    ? t('layout.capture.contentCopied')
                    : t('layout.capture.copyTab')
                }
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={!current?.copyValue}
                    onClick={() => void copyCurrent()}
                    aria-label={t('layout.capture.copyTab')}
                    sx={{ mx: 1 }}
                  >
                    <ContentCopyRounded fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
            <Box sx={{ p: 1.5, maxHeight: 280, overflow: 'auto' }}>
              {current?.content}
            </Box>
          </>
        ) : (
          <Box sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              {placeholder}
            </Typography>
          </Box>
        )}
      </Box>
      <CaptureCopyDialog
        command={copyText}
        title={t('layout.capture.copyTab')}
        onClose={() => setCopyText(null)}
      />
    </Stack>
  )
}
