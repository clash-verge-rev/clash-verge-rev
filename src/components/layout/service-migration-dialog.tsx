import { Alert } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { fetchSystemState } from '@/hooks/use-system-state'
import { useVisibility } from '@/hooks/use-visibility'
import {
  continueWithSidecar,
  getRunningMode,
  getServiceInstallState,
  reinstallService,
  repairService,
  restartCore,
  type ServiceInstallState,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { setCacheDataAsync, useQuery } from '@/services/query-client'
import getSystem from '@/utils/get-system'

const isMacos = getSystem() === 'macos'
const installStateQueryKey = ['getServiceInstallState'] as const

export const ServiceMigrationDialog = () => {
  const { t } = useTranslation()
  const pageVisible = useVisibility()
  const [loading, setLoading] = useState(false)
  const [stateRefreshFailed, setStateRefreshFailed] = useState(false)
  const [workflowIncomplete, setWorkflowIncomplete] = useState(false)
  const { data: state } = useQuery({
    queryKey: installStateQueryKey,
    queryFn: getServiceInstallState,
    enabled: isMacos,
    retry: 1,
    refetchInterval: pageVisible ? 2000 : false,
  })
  const dialogState = stateRefreshFailed ? 'unavailable' : state
  const open =
    isMacos &&
    (loading ||
      workflowIncomplete ||
      dialogState === 'needsReinstall' ||
      dialogState === 'unavailable')

  const refreshInstallState = async () => {
    try {
      const data = await getServiceInstallState()
      await setCacheDataAsync<ServiceInstallState>(installStateQueryKey, data)
      setStateRefreshFailed(false)
      return data
    } catch (error) {
      setStateRefreshFailed(true)
      await setCacheDataAsync<ServiceInstallState>(
        installStateQueryKey,
        'unavailable',
      )
      throw error
    }
  }

  const refreshSystemAndRunning = async () => {
    const [systemState, runningMode] = await Promise.all([
      fetchSystemState(),
      getRunningMode(),
    ])
    await Promise.all([
      setCacheDataAsync(['getSystemState'], { ...systemState, runningMode }),
      setCacheDataAsync(['getRunningMode'], runningMode),
    ])
  }

  const handleServiceAction = async () => {
    setLoading(true)
    setWorkflowIncomplete(true)
    let actionSucceeded = false
    try {
      if (dialogState === 'unavailable') {
        await repairService()
      } else {
        await reinstallService()
      }
      actionSucceeded = true
    } catch (error) {
      showNotice.error(error)
    }

    let initialRefreshSucceeded = false
    try {
      await refreshInstallState()
      initialRefreshSucceeded = true
    } catch (error) {
      showNotice.error(error)
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
      showNotice.error(error)
    }

    let finalRefreshSucceeded = false
    try {
      await refreshInstallState()
      finalRefreshSucceeded = true
    } catch (error) {
      showNotice.error(error)
    }
    let revalidationSucceeded = false
    try {
      await refreshSystemAndRunning()
      revalidationSucceeded = true
    } catch (error) {
      showNotice.error(error)
    }
    if (restartSucceeded && finalRefreshSucceeded && revalidationSucceeded) {
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
      await refreshInstallState()
      installRefreshSucceeded = true
    } catch (error) {
      showNotice.error(error)
    }
    let revalidationSucceeded = false
    try {
      await refreshSystemAndRunning()
      revalidationSucceeded = true
    } catch (error) {
      showNotice.error(error)
    }
    if (startupError) {
      showNotice.error(startupError)
    } else if (installRefreshSucceeded && revalidationSucceeded) {
      setWorkflowIncomplete(false)
    }
    setLoading(false)
  }

  return (
    <BaseDialog
      open={open}
      title={t('layout.components.serviceMigration.title')}
      okBtn={t(
        dialogState === 'unavailable'
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
          dialogState === 'unavailable'
            ? 'layout.components.serviceMigration.unavailableMessage'
            : 'layout.components.serviceMigration.message',
        )}
      </Alert>
    </BaseDialog>
  )
}
