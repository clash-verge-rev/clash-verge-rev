const SERVICE_URL_PREFIX =
  'https://github.com/clash-verge-rev/clash-verge-service-ipc/releases/download'

export function resolveServiceRelease(cargoManifest, host, platform) {
  const dependency = cargoManifest
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith('clash_verge_service_ipc ='))
  const packageVersion = dependency?.match(/\bversion\s*=\s*"([^"]+)"/)?.[1]
  if (!packageVersion) {
    throw new Error(
      'clash_verge_service_ipc dependency must declare an inline version',
    )
  }

  const version = `v${packageVersion}`
  const archiveExt = platform === 'win32' ? 'zip' : 'tar.gz'
  const archiveFile = `clash-verge-service-ipc-${version}-${host}.${archiveExt}`
  return {
    version,
    archiveFile,
    downloadURL: `${SERVICE_URL_PREFIX}/${version}/${archiveFile}`,
  }
}
