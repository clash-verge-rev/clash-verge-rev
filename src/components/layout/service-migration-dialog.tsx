import { Alert } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { runStateQueryKey } from '@/hooks/use-system-state'
import { useVisibility } from '@/hooks/use-visibility'
import {
  continueWithSidecar,
  getRuntimeState,
  installService,
  reinstallService,
  repairService,
  restartCore,
  type RunState,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { setCacheDataAsync, useQuery } from '@/services/query-client'

export const ServiceMigrationDialog = () => {
  const { t } = useTranslation()
  const pageVisible = useVisibility()
  const [loading, setLoading] = useState(false)
  const [stateRefreshFailed, setStateRefreshFailed] = useState(false)
  const [workflowIncomplete, setWorkflowIncomplete] = useState(false)
  const { data: runState } = useQuery({
    queryKey: runStateQueryKey,
    queryFn: getRuntimeState,
    enabled: true,
    retry: 1,
    refetchInterval: pageVisible ? 30000 : false,
  })
  // Whether the service needs a decision is derived once, in Rust, and travels with the
  // snapshot; a failed refresh is treated as needing one, since we cannot tell otherwise.
  const needsDecision =
    stateRefreshFailed || Boolean(runState?.serviceNeedsAttention)
  // Which of the three remedies the dialog offers. A refresh we could not complete is
  // treated as an unreachable service, which is what 'repair' is for.
  const remedy: 'install' | 'repair' | 'reinstall' =
    runState?.pendingAction === 'install'
      ? 'install'
      : stateRefreshFailed || runState?.service === 'unavailable'
        ? 'repair'
        : 'reinstall'
  const open = loading || workflowIncomplete || needsDecision
  const showCheckingMessage = loading || !needsDecision

  // One cache entry to refresh, so there is nothing left to keep coherent by hand.
  const refreshRunState = async () => {
    try {
      const data = await getRuntimeState()
      await setCacheDataAsync<RunState>(runStateQueryKey, data)
      setStateRefreshFailed(false)
      return data
    } catch (error) {
      setStateRefreshFailed(true)
      throw error
    }
  }

  const handleServiceAction = async () => {
    setLoading(true)
    setWorkflowIncomplete(true)
    let actionSucceeded = false
    try {
      if (remedy === 'install') {
        await installService()
      } else if (remedy === 'repair') {
        await repairService()
      } else {
        await reinstallService()
      }
      actionSucceeded = true
    } catch (error) {
      showNotice.error(
        'layout.components.serviceMigration.errors.actionFailed',
        error,
      )
    }

    let initialRefreshSucceeded = false
    try {
      await refreshRunState()
      initialRefreshSucceeded = true
    } catch (error) {
      showNotice.error(
        'layout.components.serviceMigration.errors.stateRefreshFailed',
        error,
      )
    }
    if (!actionSucceeded || !initialRefreshSucceeded) {
      setLoading(false)
      return
    }

    let restartSucceeded = false
    try {
      await restartCore()
      restartSucceeded = true
    } catch (error) {
      showNotice.error(
        'layout.components.serviceMigration.errors.restartFailed',
        error,
      )
    }

    let finalRefreshSucceeded = false
    try {
      await refreshRunState()
      finalRefreshSucceeded = true
    } catch (error) {
      showNotice.error(
        'layout.components.serviceMigration.errors.stateRefreshFailed',
        error,
      )
    }
    if (restartSucceeded && finalRefreshSucceeded) {
      setWorkflowIncomplete(false)
      showNotice.success('layout.components.serviceMigration.success')
    }
    setLoading(false)
  }

  const handleContinue = async () => {
    setLoading(true)
    setWorkflowIncomplete(true)
    let startupError: unknown
    try {
      await continueWithSidecar()
    } catch (error) {
      startupError = error
    }

    let installRefreshSucceeded = false
    try {
      await refreshRunState()
      installRefreshSucceeded = true
    } catch (error) {
      showNotice.error(
        'layout.components.serviceMigration.errors.stateRefreshFailed',
        error,
      )
    }
    if (startupError) {
      showNotice.error(
        'layout.components.serviceMigration.errors.sidecarFailed',
        startupError,
      )
    } else if (installRefreshSucceeded) {
      setWorkflowIncomplete(false)
    }
    setLoading(false)
  }

  return (
    <BaseDialog
      open={open}
      title={t('layout.components.serviceMigration.title')}
      okBtn={t(
        remedy === 'install'
          ? 'settings.sections.proxyControl.actions.installService'
          : remedy === 'repair'
            ? 'layout.components.serviceMigration.repair'
            : 'layout.components.serviceMigration.reinstall',
      )}
      cancelBtn={t('layout.components.serviceMigration.continueSidecar')}
      disableOk={loading}
      disableCancel={loading}
      loading={loading}
      onOk={() => void handleServiceAction()}
      onCancel={() => void handleContinue()}
    >
      <Alert severity="warning">
        {t(
          showCheckingMessage
            ? 'layout.components.serviceMigration.checkingMessage'
            : remedy === 'reinstall'
              ? 'layout.components.serviceMigration.message'
              : 'layout.components.serviceMigration.unavailableMessage',
        )}
      </Alert>
    </BaseDialog>
  )
}
