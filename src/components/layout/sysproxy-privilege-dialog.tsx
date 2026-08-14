import { Alert, LinearProgress, Typography } from '@mui/material'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { useDialogFailure } from '@/pages/_layout/hooks'
import {
  getRuntimeState,
  installService,
  patchVergeConfig,
  restartCore,
  type FailedOperation,
  type PendingFailure,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import {
  clearServiceRequest,
  getServiceRequest,
  subscribeServiceRequest,
  type ServiceRequest,
  type ServiceRequestReason,
} from '@/services/service-request'

type Remedy = 'installAndRestart' | 'restartOnly'

const remedyFor = (reason: ServiceRequestReason): Remedy =>
  reason === 'sysproxySidecarReady' ? 'restartOnly' : 'installAndRestart'

const EXPLANATION = {
  sysproxyRefused: 'layout.components.sysproxyPrivilege.message',
  sysproxySidecarReady:
    'layout.components.sysproxyPrivilege.serviceReadyMessage',
  tunNeedsService: 'layout.components.sysproxyPrivilege.tunMessage',
} as const

const TITLE = {
  sysproxyRefused: 'layout.components.sysproxyPrivilege.title',
  sysproxySidecarReady: 'layout.components.sysproxyPrivilege.title',
  tunNeedsService: 'layout.components.sysproxyPrivilege.tunTitle',
} as const

const stateToRestore = (
  operation: FailedOperation,
): Partial<IVergeConfig> | undefined => {
  switch (operation) {
    case 'systemProxyEnable':
      return { enable_system_proxy: true }
    case 'systemProxyDisable':
      return { enable_system_proxy: false }
    case 'systemProxyRestore':
    case 'systemProxyGuard':
      return undefined
  }
}

const asServiceRequest = (failure: PendingFailure): ServiceRequest => ({
  reason:
    failure.code === 'SYSPROXY_SIDECAR_WHILE_SERVICE_READY'
      ? 'sysproxySidecarReady'
      : 'sysproxyRefused',
  restore: stateToRestore(failure.operation),
})

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
  const asked = useSyncExternalStore(subscribeServiceRequest, getServiceRequest)
  const [step, setStep] = useState<Step>('idle')
  const loading = step !== 'idle'

  // Prefer the request the user just made over a pending failure.
  const request = asked ?? (failure ? asServiceRequest(failure) : null)

  const reason = request?.reason ?? 'sysproxyRefused'
  const remedy = remedyFor(reason)
  const restoring = request?.restore

  const close = () => {
    clearServiceRequest()
    dismiss()
  }

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
          await patchVergeConfig(restoring)
        }
        showNotice.success(
          restoring === undefined
            ? 'settings.sections.proxyControl.messages.installedCheckProxy'
            : 'settings.sections.proxyControl.messages.installedProxyRestored',
        )
        close()
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
      open={Boolean(request)}
      title={t(TITLE[reason])}
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
      onCancel={close}
      onClose={close}
    >
      <Alert severity={loading ? 'info' : 'warning'} sx={{ mb: 1.5 }}>
        {t(step !== 'idle' ? STEP_MESSAGE[step] : EXPLANATION[reason])}
      </Alert>
      {loading && <LinearProgress />}
      {!loading && reason === 'sysproxyRefused' && (
        <Typography variant="body2" color="text.secondary">
          {t('layout.components.sysproxyPrivilege.alternative')}
        </Typography>
      )}
    </BaseDialog>
  )
}
