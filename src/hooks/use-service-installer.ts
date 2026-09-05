import { useCallback } from 'react'

import { getRuntimeState, installService, restartCore } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { setCacheDataAsync } from '@/services/query-client'

import { runStateQueryKey } from './use-system-state'

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
    const state = await executeWithErrorHandling(async () => {
      await installService()
      const state = await getRuntimeState()
      await setCacheDataAsync(runStateQueryKey, state)
      return state
    }, 'settings.statuses.clashService.installing')

    if (state.service === 'approvalRequired') return
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
