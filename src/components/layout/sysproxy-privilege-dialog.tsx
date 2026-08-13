import { Alert, LinearProgress, Typography } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { useDialogFailure } from '@/pages/_layout/hooks'
import {
  getRuntimeState,
  installService,
  patchVergeConfig,
  restartCore,
  type FailedOperation,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

type Remedy = 'installAndRestart' | 'restartOnly'

const remedyFor = (code: string): Remedy =>
  code === 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY'
    ? 'restartOnly'
    : 'installAndRestart'

const stateToRestore = (operation: FailedOperation): boolean | undefined => {
  switch (operation) {
    case 'systemProxyEnable':
      return true
    case 'systemProxyDisable':
      return false
    case 'systemProxyRestore':
    case 'systemProxyGuard':
      return undefined
  }
}

type Step = 'idle' | 'installing' | 'restarting' | 'applying'

const STEP_MESSAGE = {
  installing: 'layout.components.sysproxyPrivilege.installing',
  restarting: 'layout.components.sysproxyPrivilege.restarting',
  applying: 'layout.components.sysproxyPrivilege.applying',
} as const

/** Guide recovery from a refused system-proxy write. */
export const SysproxyPrivilegeDialog = () => {
  const { t } = useTranslation()
  const { failure, dismiss } = useDialogFailure()
  const [step, setStep] = useState<Step>('idle')
  const loading = step !== 'idle'

  const remedy = failure ? remedyFor(failure.code) : 'installAndRestart'
  const restoring = failure ? stateToRestore(failure.operation) : undefined

  const handleFix = async () => {
    try {
      if (remedy === 'installAndRestart') {
        setStep('installing')
        await installService()
      }
      setStep('restarting')
      await restartCore()

      // Verify that restart actually moved the core into the service.
      const runState = await getRuntimeState()
      if (runState.mode === 'Service') {
        // Retry the original request now that the service can apply it.
        if (restoring !== undefined) {
          setStep('applying')
          await patchVergeConfig({ enable_system_proxy: restoring })
        }
        showNotice.success(
          restoring === undefined
            ? 'settings.sections.proxyControl.messages.installedCheckProxy'
            : 'settings.sections.proxyControl.messages.installedProxyRestored',
        )
        // Close after the service remedy succeeds; the proxy request may remain pending.
        dismiss()
      } else {
        showNotice.error(
          'settings.sections.proxyControl.messages.installedCoreNotOnService',
        )
      }
    } catch (error) {
      showNotice.error(error)
    } finally {
      setStep('idle')
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
      // Keep the primary spinner visible; only cancellation is unavailable.
      disableCancel={loading}
      loading={loading}
      onOk={() => void handleFix()}
      onCancel={dismiss}
      onClose={dismiss}
    >
      <Alert severity={loading ? 'info' : 'warning'} sx={{ mb: 1.5 }}>
        {t(
          step !== 'idle'
            ? STEP_MESSAGE[step]
            : remedy === 'installAndRestart'
              ? 'layout.components.sysproxyPrivilege.message'
              : 'layout.components.sysproxyPrivilege.serviceReadyMessage',
        )}
      </Alert>
      {loading && <LinearProgress />}
      {!loading && remedy === 'installAndRestart' && (
        <Typography variant="body2" color="text.secondary">
          {t('layout.components.sysproxyPrivilege.alternative')}
        </Typography>
      )}
    </BaseDialog>
  )
}
