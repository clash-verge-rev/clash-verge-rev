// Aliased in place of '@tauri-apps/api/core' only by the perf build. The
// direct relative import keeps the original module outside the alias so this
// shim can forward to it. Invocation stays byte-identical for every scenario
// except proxy, which needs the JavaScript invoke adapter.
import {
  Channel,
  convertFileSrc,
  invoke as realInvoke,
  type InvokeArgs,
  type InvokeOptions,
} from '../../node_modules/@tauri-apps/api/core.js'

import { mockCommand } from './invoke-mock'
import { scenario } from './replay'

const proxied = scenario === 'proxy'

export const invoke = async <T>(
  cmd: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> => {
  if (proxied) {
    const mocked = mockCommand(cmd)
    if (mocked !== undefined) return mocked as T
  }
  return realInvoke(cmd, args, options)
}

export { Channel, convertFileSrc }
