import { Alert, Typography } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { useDialogFailure } from '@/pages/_layout/hooks'
import { getRuntimeState, installService, restartCore } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

type Remedy = 'installAndRestart' | 'restartOnly'

const remedyFor = (code: string): Remedy =>
  code === 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY'
    ? 'restartOnly'
    : 'installAndRestart'

/** Guide recovery from a refused system-proxy write. */
export const SysproxyPrivilegeDialog = () => {
  const { t } = useTranslation()
  const { failure, dismiss } = useDialogFailure()
  const [loading, setLoading] = useState(false)

  const remedy = failure ? remedyFor(failure.code) : 'installAndRestart'

  const handleFix = async () => {
    setLoading(true)
    try {
      if (remedy === 'installAndRestart') {
        await installService()
      }
      await restartCore()

      // Verify that restart actually moved the core into the service.
      const runState = await getRuntimeState()
      if (runState.mode === 'Service') {
        showNotice.success(
          'settings.sections.proxyControl.messages.installedCheckProxy',
        )
      } else {
        showNotice.error(
          'settings.sections.proxyControl.messages.installedCoreNotOnService',
        )
      }
    } catch (error) {
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <BaseDialog
      open={Boolean(failure)}
      title={t('layout.components.sysproxyPrivilege.title')}
      okBtn={t(
        remedy === 'installAndRestart'
          ? 'settings.sections.proxyControl.actions.installService'
          : 'settings.sections.proxyControl.actions.switchToServiceMode',
      )}
      cancelBtn={t('layout.components.sysproxyPrivilege.later')}
      disableOk={loading}
      disableCancel={loading}
      loading={loading}
      onOk={() => void handleFix()}
      onCancel={dismiss}
      onClose={dismiss}
    >
      <Alert severity="warning" sx={{ mb: 1.5 }}>
        {t(
          remedy === 'installAndRestart'
            ? 'layout.components.sysproxyPrivilege.message'
            : 'layout.components.sysproxyPrivilege.serviceReadyMessage',
        )}
      </Alert>
      {remedy === 'installAndRestart' && (
        <Typography variant="body2" color="text.secondary">
          {t('layout.components.sysproxyPrivilege.alternative')}
        </Typography>
      )}
    </BaseDialog>
  )
}
