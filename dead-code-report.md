# Dead Code Analysis Report

Generated at: 2025-07-13T07:34:43.231Z

## TypeScript Unused Exports

❌ Issues found:

```
21 modules with unused exports
/home/runner/work/clash-verge-rev/clash-verge-rev/src/App.tsx: default
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/center.tsx: Center
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/base/base-loading-overlay.tsx: BaseLoadingOverlayProps, default
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/base/index.ts: NoticeManager
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/home/current-proxy-card.tsx: ProxySortType
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/home/enhanced-card.tsx: EnhancedCardProps
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/home/home-profile-card.tsx: ProfileItem, HomeProfileCardProps
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/proxy/use-filter-sort.ts: default
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/setting/mods/backup-config-viewer.tsx: BackupConfigViewerProps
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/setting/mods/backup-table-viewer.tsx: BackupTableViewerProps
/home/runner/work/clash-verge-rev/clash-verge-rev/src/components/setting/mods/password-input.tsx: PasswordInput
/home/runner/work/clash-verge-rev/clash-verge-rev/src/hooks/use-current-proxy.ts: useCurrentProxy
/home/runner/work/clash-verge-rev/clash-verge-rev/src/hooks/use-log-data.ts: ILogItem, useLogData, clearLogs
/home/runner/work/clash-verge-rev/clash-verge-rev/src/pages/home.tsx: HomePage
/home/runner/work/clash-verge-rev/clash-verge-rev/src/pages/test.tsx: default
/home/runner/work/clash-verge-rev/clash-verge-rev/src/services/api.ts: getProxyDelay, getProxiesInner
/home/runner/work/clash-verge-rev/clash-verge-rev/src/services/cmds.ts: getRuntimeExists, getAutoLaunchStatus, startCore, getPortableFlag, scriptValidateNotice, validateScriptFile, reinstallService, repairService, exit_lightweight_mode
/home/runner/work/clash-verge-rev/clash-verge-rev/src/services/global-log-service.ts: useGlobalLogStore, closeGlobalLogConnection
/home/runner/work/clash-verge-rev/clash-verge-rev/src/services/noticeService.ts: NoticeItem, clearAllNotices
/home/runner/work/clash-verge-rev/clash-verge-rev/src/utils/ignore-case.ts: default
/home/runner/work/clash-verge-rev/clash-verge-rev/src/utils/websocket.ts: createSockette

```

## Unimported Files

❌ Issues found:

```

       summary               unimported v1.31.1 (node)
────────────────────────────────────────────────────────────────────────────────
       entry file          : src/main.tsx

       unresolved imports  : 18
       unused dependencies : 7
       unimported files    : 8


─────┬──────────────────────────────────────────────────────────────────────────
     │ 18 unresolved imports
─────┼──────────────────────────────────────────────────────────────────────────
   1 │ @/assets/image/component/match_case.svg?react at src/components/base/base-search-box.tsx
   2 │ @/assets/image/component/match_whole_word.svg?react at src/components/base/base-search-box.tsx
   3 │ @/assets/image/component/use_regular_expression.svg?react at src/components/base/base-search-box.tsx
   4 │ @/assets/image/test/apple.svg?raw at src/components/home/test-card.tsx
   5 │ @/assets/image/test/github.svg?raw at src/components/home/test-card.tsx
   6 │ @/assets/image/test/google.svg?raw at src/components/home/test-card.tsx
   7 │ @/assets/image/test/youtube.svg?raw at src/components/home/test-card.tsx
   8 │ @/assets/image/itemicon/home.svg?react at src/pages/_routers.tsx
   9 │ @/assets/image/itemicon/proxies.svg?react at src/pages/_routers.tsx
  10 │ @/assets/image/itemicon/profiles.svg?react at src/pages/_routers.tsx
  11 │ @/assets/image/itemicon/connections.svg?react at src/pages/_routers.tsx
  12 │ @/assets/image/itemicon/rules.svg?react at src/pages/_routers.tsx
  13 │ @/assets/image/itemicon/logs.svg?react at src/pages/_routers.tsx
  14 │ @/assets/image/itemicon/unlock.svg?react at src/pages/_routers.tsx
  15 │ @/assets/image/itemicon/settings.svg?react at src/pages/_routers.tsx
  16 │ @/assets/image/logo.svg?react at src/pages/_layout.tsx
  17 │ @/assets/image/icon_light.svg?react at src/pages/_layout.tsx
  18 │ @/assets/image/icon_dark.svg?react at src/pages/_layout.tsx
─────┴──────────────────────────────────────────────────────────────────────────


─────┬──────────────────────────────────────────────────────────────────────────
     │ 7 unused dependencies
─────┼──────────────────────────────────────────────────────────────────────────
   1 │ @tauri-apps/plugin-global-shortcut
   2 │ @tauri-apps/plugin-notification
   3 │ @tauri-apps/plugin-window-state
   4 │ @types/json-schema
   5 │ cli-color
   6 │ glob
   7 │ tar
─────┴──────────────────────────────────────────────────────────────────────────


─────┬──────────────────────────────────────────────────────────────────────────
     │ 8 unimported files
─────┼──────────────────────────────────────────────────────────────────────────
   1 │ src/App.tsx
   2 │ src/components/center.tsx
   3 │ src/components/setting/mods/password-input.tsx
   4 │ src/hooks/use-current-proxy.ts
   5 │ src/hooks/useNotificationPermission.ts
   6 │ src/pages/test.tsx
   7 │ src/utils/ignore-case.ts
   8 │ src/utils/notification-permission.ts
─────┴──────────────────────────────────────────────────────────────────────────


       Inspect the results and run npx unimported -u to update ignore lists

```

## Rust Unused Dependencies

❌ Issues found:

```
cargo-machete found the following unused dependencies in ./src-tauri/Cargo.toml:
clash-verge -- ./src-tauri/Cargo.toml:
	async-trait
	image
	tauri-build
	tempfile

If you believe cargo-machete has detected an unused dependency incorrectly,
you can add the dependency to the list of dependencies to ignore in the
`[package.metadata.cargo-machete]` section of the appropriate Cargo.toml.
For example:

[package.metadata.cargo-machete]
ignored = ["prost"]


```

## Summary

❌ Dead code and unused dependencies were found. Please review the results above.

## Recommended Actions

1. Remove unused exports from TypeScript files
2. Delete unimported files if they're no longer needed
3. Remove unused dependencies from package.json and Cargo.toml
4. Consider adding eslint rules to prevent unused code in the future

