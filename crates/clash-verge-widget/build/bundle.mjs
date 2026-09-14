import { execFileSync } from 'node:child_process'
import { X509Certificate, randomBytes } from 'node:crypto'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const crate = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = resolve(crate, '../..')
const app = join(root, 'src-tauri')
const stage = join(app, 'generated/widget')
const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(
      `${command} failed (${error.status}); ${command === 'security' ? 'check signing credentials' : error.stderr?.toString() || 'no diagnostic output'}`,
      { cause: error },
    )
  }
}
const config = JSON.parse(readFileSync(join(app, 'tauri.conf.json'), 'utf8'))
const mac = JSON.parse(readFileSync(join(app, 'tauri.macos.conf.json'), 'utf8'))
const temporary = mkdtempSync(join(tmpdir(), 'verge-widget-build-'))
let keychain
try {
  if (process.platform !== 'darwin')
    throw new Error('Widget packaging requires macOS.')
  run('xcodebuild', ['-version'])
  run('xcrun', ['--find', 'appintentsmetadataprocessor'])
  const target = process.env.TAURI_ENV_TARGET_TRIPLE
  const arch = {
    'aarch64-apple-darwin': 'arm64',
    'x86_64-apple-darwin': 'x86_64',
    'universal-apple-darwin': 'arm64 x86_64',
  }[target]
  if (!arch) throw new Error(`Unsupported widget target: ${target}`)
  if (process.env.APPLE_CERTIFICATE) {
    keychain = join(temporary, 'widget.keychain-db')
    const password = randomBytes(24).toString('hex')
    const certificate = join(temporary, 'signing.p12')
    writeFileSync(
      certificate,
      Buffer.from(process.env.APPLE_CERTIFICATE, 'base64'),
      { mode: 0o600 },
    )
    run('security', ['create-keychain', '-p', password, keychain])
    run('security', ['unlock-keychain', '-p', password, keychain])
    run('security', [
      'import',
      certificate,
      '-k',
      keychain,
      '-P',
      process.env.APPLE_CERTIFICATE_PASSWORD || '',
      '-T',
      '/usr/bin/codesign',
    ])
    run('security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      password,
      keychain,
    ])
  }
  const keychainArgs = keychain ? [keychain] : []
  const identities = [
    ...run('security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
      ...keychainArgs,
    ]).matchAll(/\b([A-F0-9]{40}) "([^"]+)"/g),
  ].map((match) => ({ hash: match[1], name: match[2] }))
  const requested =
    process.env.APPLE_SIGNING_IDENTITY || mac.bundle.macOS.signingIdentity
  if (requested === '-') {
    console.warn(
      'CLASH_VERGE_WIDGET=0: skipping widget embedding; this build has no desktop widget extension.',
    )
    process.exit(0)
  }
  if (!requested)
    throw new Error(
      'pnpm build on macOS needs APPLE_SIGNING_IDENTITY (or a single valid signing certificate) for widget and host signing.',
    )
  const matches = identities.filter(
    ({ hash, name }) => hash === requested.toUpperCase() || name === requested,
  )
  if (matches.length !== 1)
    throw new Error(
      'Widget packaging requires one valid Apple signing identity; run pnpm build with APPLE_SIGNING_IDENTITY set.',
    )
  const identity = matches[0]
  const certificates =
    run('security', ['find-certificate', '-a', '-p', ...keychainArgs]).match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    ) || []
  const certificate = certificates
    .map((pem) => new X509Certificate(pem))
    .find((cert) => cert.fingerprint.replaceAll(':', '') === identity.hash)
  const team = certificate?.subject.match(
    /(?:^|\n)OU=([A-Z0-9]{10})(?:\n|$)/,
  )?.[1]
  if (!team) throw new Error('Selected certificate has no Apple Team ID.')
  const group = `${team}.io.vergewidget`
  const version = config.version
  mkdirSync(stage, { recursive: true })
  run('python3', [
    '-c',
    `
import json, plistlib, sys
from pathlib import Path
app, stage, team, group, version = sys.argv[1:]
stage = Path(stage)
common = {'VergeWidgetTeam': team, 'VergeWidgetGroup': group}
info = dict(common, CFBundleIdentifier='io.github.clash-verge-rev.clash-verge-rev.widget', CFBundleName='VergeWidget', CFBundleDevelopmentRegion='zh-Hans', CFBundleDisplayName='Clash Verge Routing', CFBundleExecutable='VergeWidget', CFBundlePackageType='XPC!', CFBundleShortVersionString=version, CFBundleVersion=version, LSMinimumSystemVersion='14.0', NSExtension={'NSExtensionPointIdentifier':'com.apple.widgetkit-extension'})
with open(Path(app)/'packages/macos/info_merge.plist','rb') as f: host_info = plistlib.load(f)
host_info.update(common)
with open(Path(app)/'packages/macos/entitlements.plist','rb') as f: host_entitlements = plistlib.load(f)
host_entitlements['com.apple.security.application-groups'] = [group]
host_entitlements.pop('com.apple.security.inherit', None)
ext_entitlements = {'com.apple.security.app-sandbox': True, 'com.apple.security.application-groups': [group], 'com.apple.security.network.client': True}
for name, value in [('Widget.plist',info), ('Host.plist',host_info), ('Host.entitlements',host_entitlements), ('Widget.entitlements',ext_entitlements)]:
 with (stage/name).open('wb') as f: plistlib.dump(value,f)
`,
    app,
    stage,
    team,
    group,
    version,
  ])
  const products = join(temporary, 'products')
  run('xcodebuild', [
    '-project',
    join(crate, 'native/Widget.xcodeproj'),
    '-target',
    'VergeWidget',
    '-configuration',
    'Release',
    `CONFIGURATION_BUILD_DIR=${products}`,
    `OBJROOT=${temporary}/objects`,
    `SYMROOT=${temporary}/symbols`,
    `ARCHS=${arch}`,
    'ONLY_ACTIVE_ARCH=NO',
    'MACOSX_DEPLOYMENT_TARGET=14.0',
    'CODE_SIGNING_ALLOWED=NO',
    `WIDGET_INFO_PLIST=${stage}/Widget.plist`,
    `WIDGET_ENTITLEMENTS=${stage}/Widget.entitlements`,
    'build',
  ])
  readFileSync(
    join(
      products,
      'VergeWidget.appex/Contents/Resources/Metadata.appintents/extract.actionsdata',
    ),
  )
  const extension = join(products, 'VergeWidget.appex')
  if (process.env.WIDGET_PROFILE) {
    cpSync(
      process.env.WIDGET_PROFILE,
      join(extension, 'Contents/embedded.provisionprofile'),
    )
  }
  run('codesign', [
    '--force',
    '--sign',
    identity.hash,
    ...(keychain ? ['--keychain', keychain] : []),
    '--options',
    'runtime',
    '--entitlements',
    join(stage, 'Widget.entitlements'),
    extension,
  ])
  rmSync(join(stage, 'VergeWidget.appex'), { recursive: true, force: true })
  cpSync(extension, join(stage, 'VergeWidget.appex'), { recursive: true })
  const slices = arch.split(' ').map((architecture) => {
    const output = join(temporary, `${architecture}.dylib`)
    run('xcrun', [
      'swiftc',
      '-emit-library',
      '-parse-as-library',
      '-target',
      `${architecture}-apple-macos14.0`,
      join(crate, 'native/Bridge.swift'),
      '-o',
      output,
    ])
    return output
  })
  run('xcrun', [
    'lipo',
    '-create',
    ...slices,
    '-output',
    join(stage, 'VergeWidgetBridge.dylib'),
  ])
  console.log(
    `Prepared signed widget ${version} (${arch}); Tauri will embed it before host signing and packaging.`,
  )
} catch (error) {
  console.error(
    'Widget packaging failed:',
    error.stderr?.toString() || error.message,
  )
  process.exitCode = 1
} finally {
  if (keychain) {
    try {
      run('security', ['delete-keychain', keychain])
    } catch {
      console.error('Could not remove temporary widget keychain.')
    }
  }
  rmSync(temporary, { recursive: true, force: true })
}
