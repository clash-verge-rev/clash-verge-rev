import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const tauriRoot = path.resolve('src-tauri')
const config = JSON.parse(
  readFileSync(path.join(tauriRoot, 'tauri.macos.conf.json'), 'utf8'),
)

describe.skipIf(process.platform !== 'darwin')('macOS 原生服务打包约束', () => {
  it('系统注册的 plist 必须引用被 Tauri 作为可执行文件签名的服务', () => {
    const files: Record<string, string> = config.bundle.macOS.files
    const daemonPlists = Object.entries(files).filter(([destination]) =>
      destination.startsWith('Library/LaunchDaemons/'),
    )
    expect(daemonPlists).toHaveLength(1)
    const [destination, source] = daemonPlists[0]!
    const plist = JSON.parse(
      execFileSync(
        '/usr/bin/plutil',
        ['-convert', 'json', '-o', '-', path.join(tauriRoot, source)],
        { encoding: 'utf8' },
      ),
    )

    expect(destination).toBe(`Library/LaunchDaemons/${plist.Label}.plist`)
    expect(plist.BundleProgram).toBe('Contents/MacOS/clash-verge-service')
    expect(config.bundle.externalBin).toContain('sidecar/clash-verge-service')
    expect(plist.Program).toBeUndefined()
    expect(plist.RunAtLoad).toBe(true)
    expect(plist.KeepAlive).toBe(true)
    // root 是 LaunchDaemon 的默认身份，不能把特权服务降到 GUI 用户。
    expect(plist.UserName).toBeUndefined()
  })

  it('保留两个内核的打包和旧 macOS 最低版本', () => {
    expect(config.bundle.externalBin).toContain('sidecar/verge-mihomo')
    expect(config.bundle.externalBin).toContain('sidecar/verge-mihomo-alpha')
    expect(config.bundle.macOS.minimumSystemVersion).toBe('11.0')
  })
})
