import {
  check,
  type CheckOptions,
  type Update,
} from '@tauri-apps/plugin-updater'
import { compareVersions as compareSemver } from 'compare-versions'

import { version as appVersion } from '@root/package.json'

const normalizeVersion = (input: string | null | undefined): string | null => {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  return trimmed.replace(/^v/i, '')
}

const compareVersions = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null
  try {
    return compareSemver(a, b)
  } catch {
    return null
  }
}

const localVersionNormalized = normalizeVersion(appVersion)

export const checkUpdateSafe = async (
  options?: CheckOptions,
): Promise<Update | null> => {
  const result = await check(options ?? {})
  if (!result) return null

  const remoteVersion = result.version
  const comparison = compareVersions(remoteVersion, localVersionNormalized)

  const isBuildToStable =
    /^\d+\.\d+\.\d+\+[0-9A-Za-z.-]+$/.test(localVersionNormalized ?? '') &&
    remoteVersion === localVersionNormalized?.split('+')[0]

  if (comparison !== null && comparison <= 0 && !isBuildToStable) {
    try {
      await result.close()
    } catch (err) {
      console.warn('[updater] failed to close stale update resource', err)
    }
    return null
  }

  return result
}

export type { CheckOptions }
