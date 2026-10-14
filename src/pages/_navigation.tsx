import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined'
import ForkRightOutlinedIcon from '@mui/icons-material/ForkRightOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined'
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined'
import {
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
} from 'react'

import ConnectionsSvg from '@/assets/image/itemicon/connections.svg?react'
import HomeSvg from '@/assets/image/itemicon/home.svg?react'
import LogsSvg from '@/assets/image/itemicon/logs.svg?react'
import ProfilesSvg from '@/assets/image/itemicon/profiles.svg?react'
import ProxiesSvg from '@/assets/image/itemicon/proxies.svg?react'
import RulesSvg from '@/assets/image/itemicon/rules.svg?react'
import SettingsSvg from '@/assets/image/itemicon/settings.svg?react'
import UnlockSvg from '@/assets/image/itemicon/unlock.svg?react'

import { navigationItems } from './_navigation-meta'

// 首屏首页保持同步加载，避免路由切换前的首帧白屏；
// 其余页面路由级懒加载，按需加载对应 chunk（含 monaco-editor 等重依赖）。
import HomePage from './home'

const ConnectionsPage = lazy(() => import('./connections'))
const LogsPage = lazy(() => import('./logs'))
const ProfilePage = lazy(() => import('./profiles'))
const ProxyPage = lazy(() => import('./proxies'))
const RulesPage = lazy(() => import('./rules'))
const SettingPage = lazy(() => import('./settings'))
const UnlockPage = lazy(() => import('./unlock'))

type NavigationItem = {
  label: (typeof navigationItems)[keyof typeof navigationItems]['label']
  path: string
  icon: ReactNode[]
  Component: ComponentType | LazyExoticComponent<ComponentType>
}

export const navItems: NavigationItem[] = [
  {
    ...navigationItems.home,
    icon: [<HomeOutlinedIcon key="mui" />, <HomeSvg key="svg" />],
    Component: HomePage,
  },
  {
    ...navigationItems.proxies,
    icon: [<WifiOutlinedIcon key="mui" />, <ProxiesSvg key="svg" />],
    Component: ProxyPage,
  },
  {
    ...navigationItems.profiles,
    icon: [<DnsOutlinedIcon key="mui" />, <ProfilesSvg key="svg" />],
    Component: ProfilePage,
  },
  {
    ...navigationItems.connections,
    icon: [<LanguageOutlinedIcon key="mui" />, <ConnectionsSvg key="svg" />],
    Component: ConnectionsPage,
  },
  {
    ...navigationItems.rules,
    icon: [<ForkRightOutlinedIcon key="mui" />, <RulesSvg key="svg" />],
    Component: RulesPage,
  },
  {
    ...navigationItems.logs,
    icon: [<SubjectOutlinedIcon key="mui" />, <LogsSvg key="svg" />],
    Component: LogsPage,
  },
  {
    ...navigationItems.unlock,
    icon: [<LockOpenOutlinedIcon key="mui" />, <UnlockSvg key="svg" />],
    Component: UnlockPage,
  },
  {
    ...navigationItems.settings,
    icon: [<SettingsOutlinedIcon key="mui" />, <SettingsSvg key="svg" />],
    Component: SettingPage,
  },
]
