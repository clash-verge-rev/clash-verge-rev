import {
  getProfiles,
  patchProfile,
  syncTrayProxySelection,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'

function readLegacyTestUrls(uid: string): Record<string, string> {
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
      await syncTrayProxySelection().catch((error) => {
        console.error(
          'Failed to refresh tray after saving latency test URL:',
          error,
        )
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

const pending = new Map<string, Record<string, { url: string }>>()

export async function commitProfileTestUrl(
  uid: string,
  group: string,
  url: string,
) {
  const edit = { url: url.trim() }
  const urls = { ...pending.get(uid), [group]: edit }
  pending.set(uid, urls)
  try {
    await saveProfileTestUrls(uid, { [group]: edit.url })
    const current = pending.get(uid)
    if (current?.[group] === edit) {
      delete current[group]
      if (!Object.keys(current).length) pending.delete(uid)
    }
  } catch (error) {
    console.error('Failed to save latency test URL:', error)
  }
}

export function profileTestUrls(profile: IProfileItem): Record<string, string> {
  return {
    ...profile.latency_test_urls,
    ...Object.fromEntries(
      Object.entries(pending.get(profile.uid) ?? {}).map(([group, edit]) => [
        group,
        edit.url,
      ]),
    ),
  }
}
