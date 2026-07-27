import { Alert, AlertTitle, Box, Button, Stack } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { runStateQueryKey } from '@/hooks/use-system-state'
import { useAppRefreshers } from '@/providers/app-data-context'
import { openLogsDir, restartCore } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { revalidateQuery } from '@/services/query-client'

import type { ProxyEmptyStateReason } from './proxy-empty-state-model'

interface Props {
  reason: ProxyEmptyStateReason
}

export const ProxyEmptyState = ({ reason }: Props) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { refreshProxy } = useAppRefreshers()
  const [isRestarting, setIsRestarting] = useState(false)

  const handleRestart = useLockFn(async () => {
    setIsRestarting(true)
    try {
      await restartCore()
      await Promise.all([refreshProxy(), revalidateQuery(runStateQueryKey)])
    } catch (error) {
      showNotice.error(error)
    } finally {
      setIsRestarting(false)
    }
  })

  const title =
    reason === 'no-subscriptions'
      ? t('proxies.page.empty.noSubscriptions.title')
      : reason === 'inactive-subscription'
        ? t('proxies.page.empty.inactiveSubscription.title')
        : reason === 'core-unavailable'
          ? t('proxies.page.empty.coreUnavailable.title')
          : t('proxies.page.empty.noProxyInfo.title')
  const description =
    reason === 'no-subscriptions'
      ? t('proxies.page.empty.noSubscriptions.description')
      : reason === 'inactive-subscription'
        ? t('proxies.page.empty.inactiveSubscription.description')
        : reason === 'core-unavailable'
          ? t('proxies.page.empty.coreUnavailable.description')
          : t('proxies.page.empty.noProxyInfo.description')
  const showProfiles =
    reason === 'no-subscriptions' ||
    reason === 'inactive-subscription' ||
    reason === 'no-proxy-info'
  const showCoreActions =
    reason === 'core-unavailable' || reason === 'no-proxy-info'

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Alert
        severity="warning"
        variant="outlined"
        sx={{ width: '100%', maxWidth: 640 }}
      >
        <AlertTitle>{title}</AlertTitle>
        {description}

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ mt: 2, flexWrap: 'wrap' }}
        >
          {showProfiles && (
            <Button
              size="small"
              variant="contained"
              onClick={() => navigate('/profile')}
            >
              {t('proxies.page.empty.actions.openProfiles')}
            </Button>
          )}

          {showCoreActions && (
            <>
              <Button
                size="small"
                variant="contained"
                loading={isRestarting}
                onClick={() => void handleRestart()}
              >
                {t('proxies.page.empty.actions.restartCore')}
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={isRestarting}
                onClick={() => void openLogsDir()}
              >
                {t('proxies.page.empty.actions.openLogs')}
              </Button>
            </>
          )}
        </Stack>
      </Alert>
    </Box>
  )
}
