import { useCallback } from 'react'

import { uninstallService } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'

import { useSystemState } from './use-system-state'

export const useServiceUninstaller = () => {
  const { mutateSystemState } = useSystemState()

  const uninstallServiceAndStartSidecar = useCallback(async () => {
    let uninstallError: unknown
    showNotice.info('settings.statuses.clashService.uninstalling')
    try {
      const result = await mutate(() => uninstallService(), {
        id: 'uninstall-service',
        errorNotice: false,
      })
      if (result.ok) {
        showNotice.success(
          'settings.feedback.notifications.clashService.uninstallSuccess',
        )
      }
    } catch (error) {
      uninstallError = error
    }

    try {
      await mutateSystemState()
    } catch (error) {
      if (!uninstallError) throw error
    }

    if (uninstallError) throw uninstallError
  }, [mutateSystemState])

  return { uninstallServiceAndStartSidecar }
}
