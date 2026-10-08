import { getProfiles, patchProfile } from '@/services/cmds'
import { mutate } from '@/services/mutate'

export function readLegacyTestUrls(uid: string): Record<string, string> {
  try {
    const states = JSON.parse(localStorage.getItem('proxy-head-state') || '{}')[
      uid
    ]
    return Object.fromEntries(
      Object.entries(states || {}).flatMap(([name, state]) => {
        const url = (state as { testUrl?: string }).testUrl
        return typeof url === 'string' && url.trim() ? [[name, url.trim()]] : []
      }),
    )
  } catch {
    return {}
  }
}

export async function saveProfileTestUrls(
  uid: string,
  urls: Record<string, string>,
  migrateOnly = false,
) {
  return mutate(
    async () => {
      const profiles = await getProfiles()
      const profile = profiles.items?.find((item) => item.uid === uid)
      if (!profile || (migrateOnly && profile.latency_test_urls !== undefined))
        return
      await patchProfile(uid, {
        latency_test_urls: {
          ...(profile.latency_test_urls ?? readLegacyTestUrls(uid)),
          ...urls,
        },
      })
    },
    { id: `patch-profile:${uid}`, revalidate: [['getProfiles']] },
  )
}

const migrating = new Set<string>()

export function migrateProfileTestUrls(profiles: IProfilesConfig) {
  for (const profile of profiles.items || []) {
    if (profile.latency_test_urls !== undefined || migrating.has(profile.uid))
      continue
    const urls = readLegacyTestUrls(profile.uid)
    if (!Object.keys(urls).length) continue
    migrating.add(profile.uid)
    void saveProfileTestUrls(profile.uid, urls, true)
      .catch((error) => {
        console.error('Failed to migrate latency test URLs:', error)
      })
      .finally(() => migrating.delete(profile.uid))
  }
}

const pending = new Map<
  string,
  { urls: Record<string, string>; timer: ReturnType<typeof setTimeout> }
>()

export function scheduleProfileTestUrl(
  uid: string,
  group: string,
  url: string,
) {
  const previous = pending.get(uid)
  if (previous) clearTimeout(previous.timer)
  const urls = { ...previous?.urls, [group]: url.trim() }
  const timer = setTimeout(() => {
    void saveProfileTestUrls(uid, urls)
      .catch((error) => {
        console.error('Failed to save latency test URLs:', error)
      })
      .finally(() => {
        if (pending.get(uid)?.urls === urls) pending.delete(uid)
      })
  }, 300)
  pending.set(uid, { urls, timer })
}

export function profileTestUrls(profile: IProfileItem): Record<string, string> {
  return { ...profile.latency_test_urls, ...pending.get(profile.uid)?.urls }
}
