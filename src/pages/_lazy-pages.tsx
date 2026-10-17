import { lazy } from 'react'

// 非首页路由的懒加载入口。
// 独立成纯组件文件以满足 react-refresh/only-export-components 规则，
// 同时让 monaco-editor 等重依赖只在首次进入对应页面时才被拉取。
export const ConnectionsPage = lazy(() => import('./connections'))
export const LogsPage = lazy(() => import('./logs'))
export const ProfilePage = lazy(() => import('./profiles'))
export const ProxyPage = lazy(() => import('./proxies'))
export const RulesPage = lazy(() => import('./rules'))
export const SettingPage = lazy(() => import('./settings'))
export const UnlockPage = lazy(() => import('./unlock'))
