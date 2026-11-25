import { createContext, use } from 'react'

interface ProfileSwitchState {
  switchTarget: string | null
  visibleSwitchingProfile: string | null
  getSwitchTarget: () => string | null
  activateProfile: (
    profile: string,
    notifySuccess: boolean,
    force?: boolean,
  ) => Promise<void>
}

export const ProfileSwitchContext = createContext<ProfileSwitchState | null>(
  null,
)

export const useProfileSwitch = () => {
  const context = use(ProfileSwitchContext)
  if (!context) {
    throw new Error('useProfileSwitch requires ProfileSwitchProvider')
  }
  return context
}
