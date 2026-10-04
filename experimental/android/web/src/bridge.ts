import type { BridgeMethods } from './types.ts'

type Reply = { id: string; result?: unknown; error?: string }
type Host = { request: (json: string) => void }

declare global {
  interface Window {
    VergeNative?: Host
    __vergeReceive?: (reply: Reply | string) => void
  }
}

export class NativeBridge {
  private sequence = 0
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (reason: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  private host: Host
  private timeout: number

  // Android mutations include permission and lock waits in a 90-second deadline.
  constructor(host: Host, timeout = 95000) {
    this.host = host
    this.timeout = timeout
  }

  receive = (raw: Reply | string) => {
    let reply: Reply
    try {
      reply = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return
    }
    if (!reply || typeof reply.id !== 'string') return
    const request = this.pending.get(reply.id)
    if (!request) return
    clearTimeout(request.timer)
    this.pending.delete(reply.id)
    if (typeof reply.error === 'string')
      request.reject(new Error(redact(reply.error)))
    else if ('result' in reply) request.resolve(reply.result)
    else request.reject(new Error('系统返回了无效响应，请重试'))
  }

  call<M extends keyof BridgeMethods>(
    method: M,
    params: BridgeMethods[M]['params'],
  ): Promise<BridgeMethods[M]['result']> {
    const id = `vm-${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('操作超时，请检查系统权限和网络后重试'))
      }, this.timeout)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      try {
        this.host.request(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error('无法连接系统服务'))
      }
    })
  }
}

export function redact(text: string) {
  return text
    .replace(
      /\b(?:ssr?|vmess|vless|trojan|tuic|hysteria2?|hy2|socks5?):\/\/[^\s<>"']+/gi,
      '[proxy URL hidden]',
    )
    .replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
      try {
        return `${new URL(raw).origin}/…`
      } catch {
        return '[URL]'
      }
    })
    .replace(
      /(["']?)(token|password|secret|authorization)\1\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+|[^\s,;]+)/gi,
      '$2=[hidden]',
    )
}
