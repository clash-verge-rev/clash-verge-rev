import { Alert } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import {
  continueWithSidecar,
  getServiceInstallState,
  reinstallService,
  repairService,
  restartCore,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { revalidateQueries, useQuery } from '@/services/query-client'
import getSystem from '@/utils/get-system'

const isMacos = getSystem() === 'macos'

export const ServiceMigrationDialog = () => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const { data: state, refetch } = useQuery({
    queryKey: ['getServiceInstallState'],
    queryFn: getServiceInstallState,
    enabled: isMacos,
    retry: 1,
  })
  const open =
    isMacos && (state === 'needsReinstall' || state === 'unavailable')

  const refreshState = async () => {
    await refetch()
    await revalidateQueries([['getSystemState'], ['getRunningMode']])
  }

  const handleServiceAction = async () => {
    setLoading(true)
    try {
      if (state === 'unavailable') {
        await repairService()
      } else {
        await reinstallService()
      }
      await refetch()
    } catch (error) {
      showNotice.error(error)
      setLoading(false)
      return
    }

    try {
      await restartCore()
      showNotice.success('layout.components.serviceMigration.success')
    } catch (error) {
      showNotice.error(error)
    } finally {
      try {
        await revalidateQueries([['getSystemState'], ['getRunningMode']])
      } catch (error) {
        showNotice.error(error)
      }
      setLoading(false)
    }
  }

  const handleContinue = async () => {
    setLoading(true)
    let startupError: unknown
    try {
      await continueWithSidecar()
    } catch (error) {
      startupError = error
    }

    try {
      await refreshState()
    } catch (error) {
      showNotice.error(error)
    }
    if (startupError) showNotice.error(startupError)
    setLoading(false)
  }

  return (
    <BaseDialog
      open={open}
      title={t('layout.components.serviceMigration.title')}
      okBtn={t(
        state === 'unavailable'
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
          state === 'unavailable'
            ? 'layout.components.serviceMigration.unavailableMessage'
            : 'layout.components.serviceMigration.message',
        )}
      </Alert>
    </BaseDialog>
  )
}
