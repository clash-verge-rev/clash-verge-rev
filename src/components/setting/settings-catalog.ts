import type { TranslationKey } from '@/types/generated/i18n-keys'

export interface SettingEntry {
  id: string
  name: TranslationKey
  aliases: string
  section: TranslationKey
  path: TranslationKey
  prerequisite?: string
  target?: string
  fallback?: string
  dialog?: string
  platforms?: readonly string[]
}

type GroupDefaults = Pick<SettingEntry, 'section' | 'path'> &
  Partial<
    Pick<SettingEntry, 'dialog' | 'fallback' | 'prerequisite' | 'aliases'>
  >
type EntryOptions = Partial<Omit<SettingEntry, 'name'>>
type GroupEntries = Partial<Record<TranslationKey, string | EntryOptions>>

function group(defaults: GroupDefaults, entries: GroupEntries): SettingEntry[] {
  return (
    Object.entries(entries) as [TranslationKey, string | EntryOptions][]
  ).map(([name, value]) => {
    const options = typeof value === 'string' ? { aliases: value } : value
    return {
      ...defaults,
      ...options,
      id: options.id ?? name,
      name,
      aliases: [options.aliases, defaults.aliases].filter(Boolean).join(' '),
    }
  })
}

const system = {
  section: 'settings.sections.system.title',
  path: 'settings.sections.system.title',
} satisfies GroupDefaults

const tun = {
  section: 'settings.sections.system.title',
  path: 'settings.modals.tun.title',
  dialog: 'tun-viewer',
} satisfies GroupDefaults

const sysproxy = {
  section: 'settings.sections.system.title',
  path: 'settings.modals.sysproxy.title',
  dialog: 'sysproxy-viewer',
  fallback: 'settings.modals.sysproxy.fields.usePacMode',
  prerequisite: 'sysproxy-status',
  aliases: '代理 PAC bypass 绕过',
} satisfies GroupDefaults

const clash = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.clash.title',
} satisfies GroupDefaults

const networkInterface = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.clash.title',
  dialog: 'network-interface-viewer',
  aliases: 'network interface viewer',
} satisfies GroupDefaults

const dns = {
  section: 'settings.sections.clash.title',
  path: 'settings.modals.dns.dialog.title',
  dialog: 'dns-viewer',
  fallback: 'dns-mode',
  aliases: 'DNS 域名解析 DNS 域名解析',
} satisfies GroupDefaults

const dnsReset = {
  section: 'settings.sections.clash.title',
  path: 'settings.modals.dns.dialog.title',
  dialog: 'dns-viewer',
  aliases: 'dns viewer reset DNS 域名解析',
} satisfies GroupDefaults

const clashPort = {
  section: 'settings.sections.clash.title',
  path: 'settings.modals.clashPort.title',
  dialog: 'clash-port-viewer',
} satisfies GroupDefaults

const controller = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.externalController.title',
  dialog: 'controller-viewer',
} satisfies GroupDefaults

const externalControllerCors = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.externalCors.title',
  dialog: 'external-controller-cors',
} satisfies GroupDefaults

const webUi = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.clash.title',
  dialog: 'web-ui-viewer',
  aliases: 'web ui viewer',
} satisfies GroupDefaults

const webUiActions = {
  section: 'settings.sections.clash.title',
  path: 'settings.modals.webUI.title',
  dialog: 'web-ui-viewer',
  fallback: 'web-ui-viewer',
} satisfies GroupDefaults

const clashCore = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.clash.form.fields.clashCore',
  dialog: 'clash-core-viewer',
  fallback: 'core-variants',
} satisfies GroupDefaults

const coreVariants = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.clash.title',
  dialog: 'clash-core-viewer',
  aliases: 'core variants',
} satisfies GroupDefaults

const tunnels = {
  section: 'settings.sections.clash.title',
  path: 'settings.sections.clash.form.fields.tunnels.title',
  dialog: 'tunnels-viewer',
  fallback: 'tunnels-expand',
} satisfies GroupDefaults

const basic = {
  section: 'settings.components.verge.basic.title',
  path: 'settings.components.verge.basic.title',
} satisfies GroupDefaults

const theme = {
  section: 'settings.components.verge.basic.title',
  path: 'settings.components.verge.theme.title',
  dialog: 'theme-viewer',
} satisfies GroupDefaults

const layout = {
  section: 'settings.components.verge.basic.title',
  path: 'settings.components.verge.layout.title',
  dialog: 'layout-viewer',
  aliases: 'browse layout 布局 托盘',
} satisfies GroupDefaults

const layoutFields = {
  section: 'settings.components.verge.basic.title',
  path: 'settings.components.verge.basic.fields.layoutSetting',
  dialog: 'layout-viewer',
  aliases: 'layout 布局 托盘',
} satisfies GroupDefaults

const misc = {
  section: 'settings.components.verge.basic.title',
  path: 'settings.modals.misc.title',
  dialog: 'misc-viewer',
  aliases: 'misc 杂项',
} satisfies GroupDefaults

const hotkey = {
  section: 'settings.components.verge.basic.title',
  path: 'settings.modals.hotkey.title',
  dialog: 'hotkey-viewer',
} satisfies GroupDefaults

const advanced = {
  section: 'settings.components.verge.advanced.title',
  path: 'settings.components.verge.advanced.title',
} satisfies GroupDefaults

const backup = {
  section: 'settings.components.verge.advanced.title',
  path: 'settings.modals.backup.title',
  dialog: 'backup-viewer',
  aliases: 'backup 备份',
} satisfies GroupDefaults

const backupHistory = {
  section: 'settings.components.verge.advanced.title',
  path: 'settings.modals.backup.title',
  dialog: 'backup-history',
  fallback: 'backup-history',
} satisfies GroupDefaults

const backupWebdav = {
  section: 'settings.components.verge.advanced.title',
  path: 'settings.modals.backup.webdav.title',
  dialog: 'backup-webdav',
  fallback: 'webdav-state',
} satisfies GroupDefaults

const liteMode = {
  section: 'settings.components.verge.advanced.title',
  path: 'settings.modals.liteMode.title',
  dialog: 'lite-mode-viewer',
} satisfies GroupDefaults

const settingsCatalog: readonly SettingEntry[] = [
  ...group(system, {
    'settings.sections.system.toggles.tunMode': 'TUN 虚拟网卡 vpn',
    'settings.sections.proxyControl.actions.uninstallService': {
      id: 'service-uninstall',
      fallback: 'settings.sections.system.toggles.tunMode',
      aliases: 'service uninstall',
    },
  }),
  ...group(tun, {
    'settings.modals.tun.fields.stack': 'stack TUN 虚拟网卡',
    'settings.modals.tun.fields.dnsMode': 'dns mode TUN 虚拟网卡',
    'settings.modals.tun.fields.device': 'device TUN 虚拟网卡',
    'settings.modals.tun.fields.autoRoute': 'auto route TUN 虚拟网卡',
    'settings.modals.tun.fields.autoRedirect': {
      aliases: 'auto redirect TUN 虚拟网卡',
      prerequisite: 'settings.modals.tun.fields.autoRoute',
      platforms: ['linux'],
    },
    'settings.modals.tun.fields.strictRoute': 'strict route TUN 虚拟网卡',
    'settings.modals.tun.fields.autoDetectInterface':
      'auto detect interface TUN 虚拟网卡',
    'settings.modals.tun.fields.dnsHijack': 'dns hijack TUN 虚拟网卡',
    'settings.modals.tun.fields.mtu': 'mtu TUN 虚拟网卡',
    'settings.modals.tun.fields.routeExcludeAddress': {
      aliases: 'route exclude address TUN 虚拟网卡',
      prerequisite: 'settings.modals.tun.fields.autoRoute',
    },
    'shared.actions.resetToDefault': {
      id: 'tun-viewer-reset',
      aliases: 'tun viewer reset',
    },
  }),
  ...group(system, {
    'settings.sections.system.toggles.systemProxy': 'system proxy 系统代理',
  }),
  ...group(sysproxy, {
    'settings.modals.sysproxy.fields.proxyHost': 'proxy host',
    'settings.modals.sysproxy.fields.usePacMode': 'use pac mode',
    'settings.modals.sysproxy.fields.proxyGuard': 'proxy guard',
    'settings.modals.sysproxy.fields.guardDuration': 'guard duration',
    'settings.modals.sysproxy.fields.alwaysUseDefaultBypass':
      'always use default bypass',
    'settings.modals.sysproxy.fields.enableBypassCheck': 'enable bypass check',
    'settings.modals.sysproxy.fields.proxyBypass': 'proxy bypass',
    'settings.modals.sysproxy.fields.pacScriptContent': 'pac script content',
    'settings.modals.sysproxy.actions.editPac': 'edit pac',
  }),
  ...group(system, {
    'settings.sections.system.fields.autoLaunch': 'auto launch ',
    'settings.sections.system.fields.silentStart': 'silent start ',
  }),
  ...group(clash, {
    'settings.sections.clash.form.fields.allowLan': 'allow lan ',
  }),
  ...group(networkInterface, {
    'settings.modals.networkInterface.title': {
      id: 'network-interface-viewer',
    },
  }),
  ...group(clash, {
    'settings.sections.clash.form.fields.dnsOverwrite': 'dns overwrite ',
  }),
  ...group(dns, {
    'settings.modals.dns.fields.enable': 'enable',
    'settings.modals.dns.fields.listen': 'listen',
    'settings.modals.dns.fields.enhancedMode': 'enhancedMode',
    'settings.modals.dns.fields.fakeIpRange': 'fakeIpRange',
    'settings.modals.dns.fields.fakeIpRange6': 'fakeIpRange6',
    'settings.modals.dns.fields.fakeIpFilterMode': 'fakeIpFilterMode',
    'settings.modals.dns.fields.ipv6.label': 'label',
    'settings.modals.dns.fields.preferH3.label': 'label',
    'settings.modals.dns.fields.respectRules.label': 'label',
    'settings.modals.dns.fields.useHosts.label': 'label',
    'settings.modals.dns.fields.useSystemHosts.label': 'label',
    'settings.modals.dns.fields.directPolicy.label': 'label',
    'settings.modals.dns.fields.defaultNameserver.label': 'label',
    'settings.modals.dns.fields.nameserver.label': 'label',
    'settings.modals.dns.fields.fallback.label': 'label',
    'settings.modals.dns.fields.proxy.label': 'label',
    'settings.modals.dns.fields.directNameserver.label': 'label',
    'settings.modals.dns.fields.fakeIpFilter.label': 'label',
    'settings.modals.dns.fields.nameserverPolicy.label': 'label',
    'settings.modals.dns.fields.geoipFiltering.label': 'label',
    'settings.modals.dns.fields.geoipCode': 'geoipCode',
    'settings.modals.dns.fields.fallbackIpCidr.label': 'label',
    'settings.modals.dns.fields.fallbackDomain.label': 'label',
    'settings.modals.dns.fields.hosts.label': 'label',
  }),
  ...group(dnsReset, {
    'shared.actions.resetToDefault': {
      id: 'dns-viewer-reset',
    },
  }),
  ...group(clash, {
    'settings.sections.clash.form.fields.ipv6': 'ipv6 ',
    'settings.sections.clash.form.fields.unifiedDelay': 'unified delay ',
    'settings.sections.clash.form.fields.logLevel': 'log level ',
    'settings.sections.clash.form.fields.portConfig': 'port config ',
  }),
  ...group(clashPort, {
    'settings.modals.clashPort.fields.socks': 'clash port viewer',
    'settings.modals.clashPort.fields.http': 'clash port viewer',
    'settings.modals.clashPort.fields.redir': {
      aliases: 'clash port viewer',
      platforms: ['macos', 'linux'],
    },
    'settings.modals.clashPort.fields.tproxy': {
      aliases: 'clash port viewer',
      platforms: ['linux'],
    },
    'settings.modals.clashPort.fields.mixed': 'clash port viewer',
    'settings.modals.clashPort.actions.random': {
      id: 'port-random',
      aliases: 'port random',
    },
  }),
  ...group(clash, {
    'settings.sections.clash.form.fields.external': 'external ',
  }),
  ...group(controller, {
    'settings.sections.externalController.fields.enable': 'enable ',
    'settings.sections.externalController.fields.address': {
      aliases: 'address ',
      prerequisite: 'settings.sections.externalController.fields.enable',
    },
    'settings.sections.externalController.fields.secret': {
      aliases: 'secret ',
      prerequisite: 'settings.sections.externalController.fields.enable',
    },
  }),
  ...group(externalControllerCors, {
    'settings.sections.externalCors.fields.allowPrivateNetwork':
      'allow private network ',
    'settings.sections.externalCors.fields.allowedOrigins': 'allowed origins ',
    'settings.sections.externalCors.actions.add': 'add ',
  }),
  ...group(clash, {
    'settings.sections.clash.form.fields.webUI': 'web ui ',
  }),
  ...group(webUi, {
    'settings.modals.webUI.title': {
      id: 'web-ui-viewer',
    },
  }),
  ...group(webUiActions, {
    'shared.actions.new': {
      id: 'web-ui-new',
      aliases: 'web ui new',
    },
    'shared.actions.edit': {
      id: 'web-ui-edit',
      aliases: 'web ui edit',
    },
    'shared.actions.delete': {
      id: 'web-ui-delete',
      aliases: 'web ui delete',
    },
    'settings.modals.webUI.actions.openUrl': {
      id: 'web-ui-open',
      aliases: 'web ui open',
    },
  }),
  ...group(clash, {
    'settings.sections.clash.form.fields.clashCore': 'clash core ',
  }),
  ...group(clashCore, {
    'shared.actions.upgrade': {
      id: 'core-upgrade',
      aliases: 'core upgrade',
    },
    'shared.actions.restart': {
      id: 'core-restart',
      aliases: 'core restart',
    },
  }),
  ...group(coreVariants, {
    'settings.sections.clash.form.fields.clashCore': {
      id: 'core-variants',
    },
  }),
  ...group(clash, {
    'settings.sections.clash.form.fields.openUwpTool': {
      aliases: 'open uwp tool ',
      platforms: ['windows'],
    },
    'settings.sections.clash.form.fields.updateGeoData': 'update geo data ',
    'settings.sections.clash.form.fields.tunnels.title': 'title ',
  }),
  ...group(tunnels, {
    'settings.sections.clash.form.fields.tunnels.existing': 'existing ',
    'settings.sections.clash.form.fields.tunnels.default': 'default ',
    'settings.sections.clash.form.fields.tunnels.protocols': 'protocols ',
    'settings.sections.clash.form.fields.tunnels.localAddr': 'local addr ',
    'settings.sections.clash.form.fields.tunnels.localPort': 'local port ',
    'settings.sections.clash.form.fields.tunnels.targetAddr': 'target addr ',
    'settings.sections.clash.form.fields.tunnels.targetPort': 'target port ',
    'settings.sections.clash.form.fields.tunnels.proxyGroup': 'proxy group ',
    'settings.sections.clash.form.fields.tunnels.proxyNode': 'proxy node ',
    'settings.sections.clash.form.fields.tunnels.actions.add': 'add ',
  }),
  ...group(basic, {
    'settings.components.verge.basic.fields.language': 'language ',
    'settings.components.verge.basic.fields.themeMode': 'theme mode ',
    'settings.components.verge.basic.fields.trayClickEvent': {
      aliases: 'tray click event ',
      platforms: ['windows', 'macos'],
    },
    'settings.components.verge.basic.fields.copyEnvType': 'copy env type ',
    'settings.components.verge.basic.fields.startPage': 'start page ',
    'settings.components.verge.basic.fields.startupScript': 'startup script ',
    'settings.components.verge.basic.fields.themeSetting': 'theme setting ',
  }),
  ...group(theme, {
    'settings.components.verge.theme.actions.editCss':
      'edit css theme 主题 外观',
    'settings.components.verge.theme.fields.fontFamily':
      'fontFamily theme 主题 外观',
    'settings.components.verge.theme.fields.cssInjection':
      'cssInjection theme 主题 外观',
    'settings.components.verge.theme.fields.primaryColor': 'theme viewer',
    'settings.components.verge.theme.fields.secondaryColor': 'theme viewer',
    'settings.components.verge.theme.fields.primaryText': 'theme viewer',
    'settings.components.verge.theme.fields.secondaryText': 'theme viewer',
    'settings.components.verge.theme.fields.infoColor': 'theme viewer',
    'settings.components.verge.theme.fields.warningColor': 'theme viewer',
    'settings.components.verge.theme.fields.errorColor': 'theme viewer',
    'settings.components.verge.theme.fields.successColor': 'theme viewer',
  }),
  ...group(basic, {
    'settings.components.verge.basic.fields.layoutSetting': 'layout setting ',
  }),
  ...group(layout, {
    'settings.components.verge.basic.actions.browse': '',
  }),
  ...group(layoutFields, {
    'settings.components.verge.layout.fields.preferSystemTitlebar':
      'preferSystemTitlebar',
    'settings.components.verge.layout.fields.trafficGraph': 'trafficGraph',
    'settings.components.verge.layout.fields.memoryUsage': 'memoryUsage',
    'settings.components.verge.layout.fields.proxyGroupIcon': 'proxyGroupIcon',
    'settings.components.verge.layout.fields.pauseRenderTrafficStatsOnBlur':
      'pauseRenderTrafficStatsOnBlur',
    'settings.components.verge.layout.fields.toastPosition': 'toastPosition',
    'settings.components.verge.layout.fields.hoverNavigator': 'hoverNavigator',
    'settings.components.verge.layout.fields.hoverNavigatorDelay':
      'hoverNavigatorDelay',
    'settings.components.verge.layout.fields.navIcon': 'navIcon',
    'settings.components.verge.layout.fields.collapseNavBar': 'collapseNavBar',
    'settings.components.verge.layout.fields.trayIcon': {
      aliases: 'trayIcon',
      platforms: ['macos'],
    },
    'settings.components.verge.layout.fields.enableTraySpeed': {
      aliases: 'enableTraySpeed',
      platforms: ['macos'],
    },
    'settings.components.verge.layout.fields.proxyGroupsDisplayMode':
      'proxyGroupsDisplayMode',
    'settings.components.verge.layout.fields.showOutboundModesInline':
      'showOutboundModesInline',
    'settings.components.verge.layout.fields.commonTrayIcon': 'commonTrayIcon',
    'settings.components.verge.layout.fields.systemProxyTrayIcon':
      'systemProxyTrayIcon',
    'settings.components.verge.layout.fields.tunTrayIcon': 'tunTrayIcon',
  }),
  ...group(basic, {
    'settings.components.verge.basic.fields.misc': 'misc ',
  }),
  ...group(misc, {
    'settings.modals.misc.fields.appLogLevel': 'app log level',
    'settings.modals.misc.fields.appLogMaxSize': 'app log max size',
    'settings.modals.misc.fields.appLogMaxCount': 'app log max count',
    'settings.modals.misc.fields.autoCloseConnections':
      'auto close connections',
    'settings.modals.misc.fields.autoCheckUpdate': 'auto check update',
    'settings.modals.misc.fields.enableBuiltinEnhanced':
      'enable builtin enhanced',
    'settings.modals.misc.fields.proxyLayoutColumns': 'proxy layout columns',
    'settings.modals.misc.fields.autoLogClean': 'auto log clean',
    'settings.modals.misc.fields.autoDelayDetection': 'auto delay detection',
    'settings.modals.misc.fields.autoDelayDetectionInterval': {
      aliases: 'auto delay detection interval',
      prerequisite: 'settings.modals.misc.fields.autoDelayDetection',
    },
    'settings.modals.misc.fields.defaultLatencyTest': 'default latency test',
    'settings.modals.misc.fields.defaultLatencyTimeout':
      'default latency timeout',
  }),
  ...group(basic, {
    'settings.components.verge.basic.fields.hotkeySetting': 'hotkey setting ',
  }),
  ...group(hotkey, {
    'settings.modals.hotkey.functions.openOrCloseDashboard': 'hotkey viewer',
    'settings.modals.hotkey.functions.rule': 'hotkey viewer',
    'settings.modals.hotkey.functions.global': 'hotkey viewer',
    'settings.modals.hotkey.functions.direct': 'hotkey viewer',
    'settings.modals.hotkey.functions.toggleSystemProxy': 'hotkey viewer',
    'settings.modals.hotkey.functions.toggleTunMode': 'hotkey viewer',
    'settings.modals.hotkey.functions.entryLightweightMode': 'hotkey viewer',
    'settings.modals.hotkey.functions.reactivateProfiles': 'hotkey viewer',
    'settings.modals.hotkey.toggles.enableGlobal':
      'settings.modals.hotkey.toggles.enableGlobal',
  }),
  ...group(advanced, {
    'settings.components.verge.advanced.fields.backupSetting':
      'backup setting ',
  }),
  ...group(backup, {
    'settings.modals.backup.actions.backup': 'backup',
  }),
  ...group(backupHistory, {
    'settings.modals.backup.actions.viewHistory': {
      aliases: 'view history backup 备份',
      target: 'backup-history',
    },
  }),
  ...group(backup, {
    'settings.modals.backup.actions.importBackup': 'import backup',
  }),
  ...group(backupWebdav, {
    'settings.modals.backup.fields.webdavUrl': 'webdavUrl WebDAV 云备份',
    'settings.modals.backup.fields.username': 'username WebDAV 云备份',
  }),
  ...group(backup, {
    'settings.modals.backup.auto.scheduleLabel': 'scheduleLabel',
    'settings.modals.backup.auto.intervalLabel': {
      aliases: 'intervalLabel',
      prerequisite: 'settings.modals.backup.auto.scheduleLabel',
    },
    'settings.modals.backup.auto.changeLabel': 'changeLabel',
  }),
  ...group(backupHistory, {
    'settings.modals.backup.history.title': {
      aliases: '备份 历史 恢复 删除 restore delete history',
      target: 'backup-history',
    },
  }),
  ...group(backupWebdav, {
    'shared.labels.password': {
      id: 'webdav-password',
      aliases: 'webdav password',
    },
    'shared.actions.save': {
      id: 'webdav-save',
      aliases: 'webdav save',
    },
    'settings.modals.backup.actions.backup': {
      id: 'webdav-backup',
      aliases: 'webdav backup',
    },
    'shared.actions.refresh': {
      id: 'webdav-refresh',
      aliases: 'webdav refresh',
    },
  }),
  ...group(backupHistory, {
    'settings.modals.backup.actions.deleteBackup': {
      id: 'backup-history-delete',
      aliases: 'backup history delete',
      path: 'settings.modals.backup.history.title',
    },
    'settings.modals.backup.actions.restoreBackup': {
      id: 'backup-history-restore',
      aliases: 'backup history restore',
      path: 'settings.modals.backup.history.title',
    },
    'settings.modals.backup.actions.exportBackup': {
      id: 'backup-history-export',
      aliases: 'backup history export',
      path: 'settings.modals.backup.history.title',
    },
  }),
  ...group(advanced, {
    'settings.components.verge.advanced.fields.runtimeConfig':
      'runtime config ',
    'settings.components.verge.advanced.fields.openConfDir': 'open conf dir ',
    'settings.components.verge.advanced.fields.openCoreDir': 'open core dir ',
    'settings.components.verge.advanced.fields.openLogsDir': 'open logs dir ',
    'settings.components.verge.advanced.fields.checkUpdates': 'check updates ',
    'settings.components.verge.advanced.fields.openDevTools': 'open dev tools ',
    'settings.components.verge.advanced.fields.liteModeSettings':
      'lite mode settings ',
  }),
  ...group(liteMode, {
    'settings.modals.liteMode.actions.enterNow': 'enter now ',
    'settings.modals.liteMode.toggles.autoEnter': 'auto enter ',
    'settings.modals.liteMode.fields.delay': {
      fallback: 'settings.modals.liteMode.toggles.autoEnter',
      aliases: 'delay ',
    },
  }),
  ...group(advanced, {
    'settings.components.verge.advanced.fields.exit': 'exit ',
    'settings.components.verge.advanced.fields.exportDiagnostics':
      'export diagnostics ',
    'settings.components.verge.advanced.fields.vergeVersion': 'verge version ',
  }),
]

export function searchSettings(
  query: string,
  platform: string,
  translate: (key: TranslationKey) => string,
  english: (key: TranslationKey) => string,
) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return settingsCatalog
    .filter((e) => !e.platforms || e.platforms.includes(platform))
    .map((entry, order) => {
      const names = (
        translate(entry.name) +
        ' ' +
        english(entry.name)
      ).toLocaleLowerCase()
      const other = (
        translate(entry.section) +
        ' ' +
        english(entry.section) +
        ' ' +
        entry.aliases +
        ' ' +
        translate(entry.path) +
        ' ' +
        english(entry.path)
      ).toLocaleLowerCase()
      const score = words.every(
        (word) => names.includes(word) || other.includes(word),
      )
        ? words.reduce((sum, word) => sum + (names.includes(word) ? 1 : 0), 0)
        : -1
      return { entry, order, score }
    })
    .filter((e) => e.score >= 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((e) => e.entry)
}
