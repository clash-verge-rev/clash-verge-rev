import { load } from 'js-yaml'
import type { BridgeMethods, Profile } from './types.ts'

const storageKey = 'verge-mobile.preview.profiles'

function profiles(): Profile[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    return []
  }
}

export class PreviewBridge {
  async call<M extends keyof BridgeMethods>(
    method: M,
    params: BridgeMethods[M]['params'],
  ): Promise<BridgeMethods[M]['result']> {
    const input = params as {
      name?: string
      content?: string
      url?: string
      id?: string
    }
    let result: unknown
    switch (method) {
      case 'status':
        result = {
          platform: 'preview',
          vpn: 'stopped',
          coreReady: false,
          canChooseFile: true,
          activeProfileId: profiles().find((p) => p.active)?.id,
        }
        break
      case 'profiles.list':
        result = profiles()
        break
      case 'profiles.import': {
        if (input.url)
          throw new Error('订阅下载需要手机原生服务，网页预览可导入本地 YAML')
        if (!input.content) throw new Error('请提供 YAML 配置')
        const config = load(input.content) as
          | Record<string, unknown>
          | undefined
        if (
          !config ||
          typeof config !== 'object' ||
          (!Array.isArray(config.proxies) && !config['proxy-providers'])
        ) {
          throw new Error('配置需要包含 proxies 或 proxy-providers')
        }
        const existing = profiles()
        const profile: Profile = {
          id: crypto.randomUUID(),
          name: input.name || '本地配置',
          active: !existing.length,
          updatedAt: new Date().toISOString(),
        }
        localStorage.setItem(storageKey, JSON.stringify([...existing, profile]))
        result = profile
        break
      }
      case 'profiles.activate': {
        const existing = profiles()
        if (!existing.some((p) => p.id === input.id))
          throw new Error('配置不存在')
        localStorage.setItem(
          storageKey,
          JSON.stringify(
            existing.map((p) => ({ ...p, active: p.id === input.id })),
          ),
        )
        result = null
        break
      }
      case 'logs.list':
        result = []
        break
      case 'proxies.list':
        result = []
        break
      default:
        throw new Error('此操作需要 Android 或鸿蒙原生安装包；当前是界面预览')
    }
    return result as BridgeMethods[M]['result']
  }
}
