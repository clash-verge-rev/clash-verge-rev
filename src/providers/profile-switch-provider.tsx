import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { useProfiles } from '@/hooks/use-profiles'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import { revalidateQuery } from '@/services/query-client'
import { debugLog } from '@/utils/debug'

import { ProfileSwitchContext } from './profile-switch-context'

const PROFILE_SWITCH_LOADING_DELAY = 400

interface ProfileSwitchRequest {
  profile: string
  notifySuccess: boolean
  force: boolean
}

const debugProfileSwitch = (
  action: string,
  profile: string,
  extra?: unknown,
) => {
  const timestamp = new Date().toISOString().substring(11, 23)
  debugLog(`[Profile-Debug][${timestamp}] ${action}: ${profile}`, extra ?? '')
}

// The Profiles route can unmount while a switch is still pending.
export const ProfileSwitchProvider = ({ children }: PropsWithChildren) => {
  const { profiles, patchProfiles } = useProfiles()
  const current = profiles?.current
  const currentProfileRef = useRef(current)
  const latestSwitchTargetRef = useRef<string | null>(null)
  const queuedSwitchRef = useRef<ProfileSwitchRequest | null>(null)
  const switchRunnerRef = useRef<Promise<void> | null>(null)
  const switchLoadingTimerRef = useRef<number | null>(null)
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [visibleSwitchingProfile, setVisibleSwitchingProfile] = useState<
    string | null
  >(null)

  useEffect(() => {
    currentProfileRef.current = current
  }, [current])

  const clearSwitchLoadingTimer = useCallback(() => {
    if (switchLoadingTimerRef.current !== null) {
      window.clearTimeout(switchLoadingTimerRef.current)
      switchLoadingTimerRef.current = null
    }
  }, [])

  useEffect(() => clearSwitchLoadingTimer, [clearSwitchLoadingTimer])

  const executeProfileSwitch = useCallback(
    async ({ profile, notifySuccess, force }: ProfileSwitchRequest) => {
      if (!force && currentProfileRef.current === profile) {
        debugProfileSwitch('ALREADY_CURRENT_IGNORED', profile)
        return
      }

      debugProfileSwitch('SWITCH_START', profile)

      try {
        const outcome = await patchProfiles({ current: profile })
        if (outcome.status === 'busy') {
          debugProfileSwitch('SWITCH_BUSY', profile)
          showNotice.info(
            'profiles.page.feedback.notifications.switchBusy',
            2000,
          )
          return
        }

        if (outcome.status === 'valid') {
          currentProfileRef.current = profile
          void revalidateQuery(['getRuntimeLogs']).catch(() => {})
          void mutate(() => closeAllConnections(), {
            id: 'close-all-connections',
            errorNotice: false,
          }).catch(() => {})

          if (
            notifySuccess &&
            latestSwitchTargetRef.current === profile &&
            queuedSwitchRef.current === null
          ) {
            showNotice.success(
              'profiles.page.feedback.notifications.profileSwitched',
              1000,
            )
          }
          debugProfileSwitch('SWITCH_SUCCESS', profile)
        } else {
          debugProfileSwitch('SWITCH_REJECTED', profile, outcome)
        }
      } catch (error) {
        console.error('[Profile] Failed to switch profile:', error)
        showNotice.error(error, 4000)
      } finally {
        debugProfileSwitch('SWITCH_END', profile)
      }
    },
    [patchProfiles],
  )

  const runProfileSwitchQueue = useCallback(async () => {
    try {
      while (queuedSwitchRef.current) {
        const request = queuedSwitchRef.current
        queuedSwitchRef.current = null
        await executeProfileSwitch(request)
      }
    } finally {
      switchRunnerRef.current = null
      latestSwitchTargetRef.current = null
      clearSwitchLoadingTimer()
      setSwitchTarget(null)
      setVisibleSwitchingProfile(null)
    }
  }, [clearSwitchLoadingTimer, executeProfileSwitch])

  const activateProfile = useCallback(
    (profile: string, notifySuccess: boolean, force = false) => {
      const currentRunner = switchRunnerRef.current
      if (!force && currentProfileRef.current === profile && !currentRunner) {
        debugProfileSwitch('ALREADY_CURRENT_IGNORED', profile)
        return Promise.resolve()
      }

      if (latestSwitchTargetRef.current === profile && currentRunner) {
        debugProfileSwitch('DUPLICATE_SWITCH_IGNORED', profile)
        return currentRunner
      }

      latestSwitchTargetRef.current = profile
      queuedSwitchRef.current = { profile, notifySuccess, force }
      setSwitchTarget(profile)
      setVisibleSwitchingProfile(null)
      clearSwitchLoadingTimer()
      switchLoadingTimerRef.current = window.setTimeout(() => {
        setVisibleSwitchingProfile(profile)
      }, PROFILE_SWITCH_LOADING_DELAY)

      if (currentRunner) {
        debugProfileSwitch('SWITCH_QUEUED', profile)
        return currentRunner
      }

      const runner = runProfileSwitchQueue()
      switchRunnerRef.current = runner
      return runner
    },
    [clearSwitchLoadingTimer, runProfileSwitchQueue],
  )

  const getSwitchTarget = useCallback(() => latestSwitchTargetRef.current, [])
  const value = useMemo(
    () => ({
      switchTarget,
      visibleSwitchingProfile,
      getSwitchTarget,
      activateProfile,
    }),
    [switchTarget, visibleSwitchingProfile, getSwitchTarget, activateProfile],
  )

  return <ProfileSwitchContext value={value}>{children}</ProfileSwitchContext>
}
