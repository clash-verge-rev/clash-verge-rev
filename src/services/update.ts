import { compare, valid } from 'semver'

import { version as appVersion } from '@root/package.json'

import { checkUpdate } from './cmds'

export const checkUpdateSafe = async (): Promise<UpdateInfo | null> => {
  const result = await checkUpdate()
  if (!result) return null

  const remoteVersion = result.version
  const localVersion = appVersion

  if (!valid(remoteVersion) || !valid(localVersion)) {
    return null
  }

  const comparison = compare(remoteVersion, localVersion)
  if (comparison <= 0) {
    return null
  }

  return result
}
