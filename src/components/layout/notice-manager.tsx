import { CloseRounded } from '@mui/icons-material'
import {
  Snackbar,
  Alert,
  Button,
  IconButton,
  Box,
  Stack,
  type SnackbarOrigin,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import React, { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { getRuntimeState, installService, restartCore } from '@/services/cmds'
import type { NoticeActionCode } from '@/services/notice-service'
import {
  boundNoticeText,
  noticeActionFor,
  subscribeNotices,
  hideNotice,
  hideNoticesForCode,
  getSnapshotNotices,
  showNotice,
} from '@/services/notice-service'
import type { TranslationKey } from '@/types/generated/i18n-keys'

type NoticePosition = NonNullable<IVergeConfig['notice_position']>
type NoticeItem = ReturnType<typeof getSnapshotNotices>[number]
type TranslationFn = ReturnType<typeof useTranslation>['t']

const VALID_POSITIONS: NoticePosition[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

const resolvePosition = (position?: NoticePosition | null): NoticePosition => {
  if (position && VALID_POSITIONS.includes(position)) {
    return position
  }
  return 'top-right'
}

const getAnchorOrigin = (position: NoticePosition): SnackbarOrigin => {
  const [vertical, horizontal] = position.split('-') as [
    SnackbarOrigin['vertical'],
    SnackbarOrigin['horizontal'],
  ]
  return { vertical, horizontal }
}

/** Resolve notice text, bounding display output but not clipboard content. */
const resolveNoticeMessage = (
  notice: NoticeItem,
  t: TranslationFn,
  options?: { bounded?: boolean },
): React.ReactNode => {
  const bound = (text: React.ReactNode): React.ReactNode =>
    options?.bounded === false || typeof text !== 'string'
      ? text
      : boundNoticeText(text)

  const i18n = notice.i18n
  if (!i18n) return bound(notice.message)

  const source = (i18n.params ?? {}) as Record<string, unknown>
  // Bound both parameters and their final interpolation.
  const params =
    options?.bounded === false
      ? source
      : Object.fromEntries(
          Object.entries(source).map(([key, value]) => [
            key,
            typeof value === 'string' ? boundNoticeText(value) : value,
          ]),
        )
  const { prefixKey, prefixParams, prefix, message, ...restParams } = params

  const prefixKeyParams =
    prefixParams && typeof prefixParams === 'object'
      ? (prefixParams as Record<string, unknown>)
      : undefined

  const resolvedPrefix =
    typeof prefixKey === 'string'
      ? t(prefixKey as TranslationKey, {
          defaultValue: prefixKey,
          ...(prefixKeyParams ?? {}),
          ...restParams,
        })
      : typeof prefix === 'string'
        ? prefix
        : undefined

  const messageStr = typeof message === 'string' ? message : undefined

  const defaultValue =
    messageStr === undefined
      ? undefined
      : resolvedPrefix
        ? `${resolvedPrefix} ${messageStr}`
        : messageStr

  return bound(
    t(i18n.key as TranslationKey, {
      defaultValue,
      ...restParams,
      ...(resolvedPrefix !== undefined ? { prefix: resolvedPrefix } : {}),
      ...(messageStr !== undefined ? { message: messageStr } : {}),
    }),
  )
}

const extractNoticeCopyText = (input: unknown): string | undefined => {
  if (input === null || input === undefined) return undefined
  if (typeof input === 'string') return input
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input)
  }
  if (input instanceof Error) {
    return input.message || input.name
  }
  if (React.isValidElement(input)) return undefined
  if (typeof input === 'object') {
    const maybeMessage = (input as { message?: unknown }).message
    if (typeof maybeMessage === 'string') return maybeMessage
  }
  try {
    return JSON.stringify(input)
  } catch {
    return String(input)
  }
}

const resolveNoticeCopyText = (
  notice: NoticeItem,
  t: TranslationFn,
): string | undefined => {
  if (
    notice.i18n?.key === 'shared.feedback.notices.prefixedRaw' ||
    notice.i18n?.key === 'shared.feedback.notices.raw'
  ) {
    const rawText = extractNoticeCopyText(notice.i18n?.params?.message)
    if (rawText) return rawText
  }

  return (
    extractNoticeCopyText(
      resolveNoticeMessage(notice, t, { bounded: false }),
    ) ?? extractNoticeCopyText(notice.message)
  )
}

/** Whether recovery resolved the source notice. */
type ActionOutcome = 'dismiss' | 'keep'

/** Run the recovery mapped to a classified failure. */
const runNoticeAction = async (
  code: NoticeActionCode,
): Promise<ActionOutcome> => {
  switch (code) {
    case 'SYSPROXY_PRIVILEGE_REQUIRED':
      // Keep the install offer only if installation itself fails.
      await installService()
      await restartIntoService()
      return 'dismiss'
    case 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY':
      return (await restartIntoService()) ? 'dismiss' : 'keep'
  }
}

/** Restart, report the resulting runtime mode, and return whether it reached the service. */
const restartIntoService = async (): Promise<boolean> => {
  try {
    await restartCore()
  } catch (error) {
    showNotice.error(error)
  }

  const runState = await getRuntimeState()

  if (runState.mode === 'Service') {
    // The failed proxy request was rolled back; leave its direction to the user.
    showNotice.info(
      'settings.sections.proxyControl.messages.installedCheckProxy',
    )
    return true
  }

  if (runState.mode === 'Sidecar' && runState.serviceUsable) {
    showNotice.error({
      code: 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY',
      detail: '',
    })
    return false
  }

  showNotice.error(
    'settings.sections.proxyControl.messages.installedCoreNotOnService',
  )
  return false
}

interface NoticeActionButtonProps {
  code: NoticeActionCode
  label: TranslationKey
}

/** Lock recovery actions that may prompt for a password. */
const NoticeActionButton: React.FC<NoticeActionButtonProps> = ({
  code,
  label,
}) => {
  const { t } = useTranslation()
  const [running, setRunning] = React.useState(false)

  const run = useLockFn(async () => {
    setRunning(true)
    try {
      if ((await runNoticeAction(code)) === 'dismiss') {
        hideNoticesForCode(code)
      }
    } catch (error) {
      showNotice.error(error)
    } finally {
      setRunning(false)
    }
  })

  return (
    <Button
      size="small"
      color="inherit"
      disabled={running}
      onClick={() => void run()}
    >
      {t(label)}
    </Button>
  )
}

interface NoticeManagerProps {
  position?: NoticePosition | null
}

export const NoticeManager: React.FC<NoticeManagerProps> = ({ position }) => {
  const { t } = useTranslation()
  const resolvedPosition = useMemo(() => resolvePosition(position), [position])
  const anchorOrigin = useMemo(
    () => getAnchorOrigin(resolvedPosition),
    [resolvedPosition],
  )
  const currentNotices = useSyncExternalStore(
    subscribeNotices,
    getSnapshotNotices,
  )

  const handleClose = (id: number) => {
    hideNotice(id)
  }

  const handleNoticeCopy = useCallback(
    async (notice: NoticeItem) => {
      const text = resolveNoticeCopyText(notice, t)
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        showNotice.success(
          'shared.feedback.notifications.common.copySuccess',
          1000,
        )
      } catch (error) {
        console.warn('[NoticeManager] copy to clipboard failed:', error)
      }
    },
    [t],
  )

  return (
    <Box
      sx={{
        position: 'fixed',
        top: anchorOrigin.vertical === 'top' ? '20px' : 'auto',
        bottom: anchorOrigin.vertical === 'bottom' ? '20px' : 'auto',
        left: anchorOrigin.horizontal === 'left' ? '20px' : 'auto',
        right: anchorOrigin.horizontal === 'right' ? '20px' : 'auto',
        zIndex: 1500,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '360px',
      }}
    >
      {currentNotices.map((notice) => (
        <Snackbar
          key={notice.id}
          open={true}
          anchorOrigin={anchorOrigin}
          sx={{
            position: 'relative',
            transform: 'none',
            top: 'auto',
            right: 'auto',
            bottom: 'auto',
            left: 'auto',
            width: '100%',
          }}
        >
          <Alert
            severity={notice.type}
            variant="filled"
            sx={{ width: '100%' }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void handleNoticeCopy(notice)
            }}
            action={
              <Stack
                direction="row"
                spacing={0.5}
                sx={{ alignItems: 'center' }}
              >
                {(() => {
                  const action = noticeActionFor(notice.code)
                  return action ? (
                    <NoticeActionButton
                      code={action.code}
                      label={action.label}
                    />
                  ) : null
                })()}
                <IconButton
                  size="small"
                  color="inherit"
                  onClick={() => handleClose(notice.id)}
                >
                  <CloseRounded fontSize="inherit" />
                </IconButton>
              </Stack>
            }
          >
            {resolveNoticeMessage(notice, t)}
          </Alert>
        </Snackbar>
      ))}
    </Box>
  )
}
