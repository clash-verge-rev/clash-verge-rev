import { useCallback } from 'react'

import { installService, restartCore } from '@/services/cmds'
import { mutate } from '@/services/mutate'
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
    const installResult = await executeWithErrorHandling(
      () =>
        mutate(() => installService(), {
          id: 'install-service',
          errorNotice: false,
        }),
      'settings.statuses.clashService.installing',
    )
    if (!installResult.ok) return
    if (installResult.value.status === 'sidecar') {
      showNotice.warning(
        'settings.feedback.notifications.clashService.permissionFallback',
        { reason: installResult.value.reason },
        0,
      )
      return
    }
    showNotice.success(
      'settings.feedback.notifications.clashService.installSuccess',
    )

    await executeWithErrorHandling(
      () =>
        mutate(() => restartCore(), {
          id: 'restart-core',
          errorNotice: false,
        }),
      'settings.statuses.clash.restarting',
      'settings.feedback.notifications.clash.restartSuccess',
    )
  }, [])
  return { installServiceAndRestartCore }
}
