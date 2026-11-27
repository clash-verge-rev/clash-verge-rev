// Only this perf build aliases '@tauri-apps/api/core' to a shim that serves
// these responses for the proxy scenario; the normal application never
// imports it. The runtime-injected __TAURI_INTERNALS__ is read-only, so
// interception happens at import resolution instead. Unknown commands pass
// through to the real backend (perf_state, event plugin), keeping harness
// ownership probes and lifecycle commands working. The proxy scenario is
// therefore a JavaScript invoke adapter, not native plugin IPC.

const GROUP_COUNT = 40
const NODES_PER_GROUP = 24

const capabilities = {
  udp: true,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
}

const history = (delay: number) => [{ time: '2026-11-19T00:00:00Z', delay }]

const buildProxyView = () => {
  const records: Record<string, unknown> = {}
  const groups: {
    name: string
    type: string
    now: string
    hidden: boolean
    history: { time: string; delay: number }[]
    members: unknown[]
  }[] = []

  for (let g = 0; g < GROUP_COUNT; g++) {
    const members: unknown[] = []
    for (let n = 0; n < NODES_PER_GROUP; n++) {
      const name = `node-${g}-${n}`
      const recordId = `record-${g}-${n}`
      records[recordId] = {
        recordId,
        name,
        type: n % 3 === 0 ? 'Shadowsocks' : n % 3 === 1 ? 'Vmess' : 'Trojan',
        history: history(30 + ((g * 7 + n * 13) % 40) * 10),
        source: { kind: 'core', proxyName: name },
        ...capabilities,
      }
      members.push({ kind: 'node', name, recordId })
    }
    groups.push({
      name: `group-${String(g).padStart(2, '0')}`,
      type: g % 2 === 0 ? 'Selector' : 'URLTest',
      now: `node-${g}-0`,
      hidden: false,
      history: history(20),
      members,
    })
  }

  return {
    schemaVersion: 1,
    orderSource: 'runtime',
    providerState: 'ready',
    global: {
      name: 'GLOBAL',
      type: 'Selector',
      now: 'group-00',
      hidden: true,
      history: [],
      members: groups.map((group) => ({ kind: 'group', name: group.name })),
      ...capabilities,
    },
    direct: 'DIRECT',
    groups: groups.map((group) => ({ ...group, ...capabilities })),
    records,
    standalone: [],
    providers: [],
  }
}

const handlers: Record<string, () => unknown> = {
  get_proxy_view: buildProxyView,
  get_verge_config: () => ({
    language: 'en',
    theme_mode: 'light',
    proxy_layout_column: 2,
    default_latency_timeout: 10000,
    enable_hover_jump_navigator: true,
    hover_jump_navigator_delay: 200,
    pause_render_traffic_stats_on_blur: false,
  }),
  get_profiles: () => ({
    current: 'perf-profile',
    items: [
      {
        uid: 'perf-profile',
        type: 'remote',
        name: 'Perf Profile',
        desc: '',
        url: '',
        selected: true,
        extra: {},
        option: { update_interval: 0 },
      },
    ],
  }),
  get_clash_info: () => ({
    mixed_port: 7897,
    socks_port: 0,
    port: 0,
    server: '127.0.0.1:9097',
    secret: null,
  }),
  get_runtime_config: () => null,
  get_sys_proxy: () => ({ enable: false, bypass: '', pac_file: '' }),
  get_runtime_state: () => ({
    mode: 'Sidecar',
    service: 'ready',
    serviceUnavailableReason: null,
    pendingAction: null,
    sidecarAllowed: true,
    isAdmin: false,
    opInFlight: false,
    serviceUsable: true,
    tunCapable: false,
    serviceNeedsAttention: false,
  }),
  get_sidecar_failure: () => null,
  get_pending_failures: () => [],
  'plugin:mihomo|get_configs': () => ({ mode: 'rule', 'mixed-port': 7897 }),
  'plugin:mihomo|get_rule_providers': () => ({ providers: {} }),
  'plugin:mihomo|get_rules': () => ({ rules: [] }),
}

/** Returns the mocked response, or undefined to pass through to the backend. */
export const mockCommand = (cmd: string): unknown => {
  const handler = handlers[cmd]
  return handler ? handler() : undefined
}
