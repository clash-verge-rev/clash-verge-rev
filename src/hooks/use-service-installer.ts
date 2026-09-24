import { useCallback } from 'react'

import { installService, restartCore } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const executeWithErrorHandling = async <T>(
  operation: () => Promise<T>,
  loadingKey: string,
  successKey?: string,
) => {
  try {
    showNotice.info(loadingKey)
    const result = await operation()
    if (successKey) {
      showNotice.success(successKey)
    }
    return result
  } catch (err) {
    showNotice.error(err)
    throw err
  }
}

export const useServiceInstaller = () => {
  const installServiceAndRestartCore = useCallback(async () => {
    const outcome = await executeWithErrorHandling(
      () => installService(),
      'settings.statuses.clashService.installing',
    )
    if (outcome.status === 'sidecar') {
      showNotice.warning(
        'settings.feedback.notifications.clashService.permissionFallback',
        { reason: outcome.reason },
        0,
      )
      return
    }
    showNotice.success(
      'settings.feedback.notifications.clashService.installSuccess',
    )

    await executeWithErrorHandling(
      () => restartCore(),
      'settings.statuses.clash.restarting',
      'settings.feedback.notifications.clash.restartSuccess',
    )
  }, [])
  return { installServiceAndRestartCore }
}
