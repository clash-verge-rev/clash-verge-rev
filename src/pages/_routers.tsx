import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined'
import ForkRightOutlinedIcon from '@mui/icons-material/ForkRightOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined'
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SubjectOutlinedIcon from '@mui/icons-material/SubjectOutlined'
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined'
import { createBrowserRouter, RouteObject } from 'react-router'

import ConnectionsSvg from '@/assets/image/itemicon/connections.svg?react'
import HomeSvg from '@/assets/image/itemicon/home.svg?react'
import LogsSvg from '@/assets/image/itemicon/logs.svg?react'
import ProfilesSvg from '@/assets/image/itemicon/profiles.svg?react'
import ProxiesSvg from '@/assets/image/itemicon/proxies.svg?react'
import RulesSvg from '@/assets/image/itemicon/rules.svg?react'
import SettingsSvg from '@/assets/image/itemicon/settings.svg?react'
import UnlockSvg from '@/assets/image/itemicon/unlock.svg?react'

import Layout from './_layout'
import ConnectionsPage from './connections'
import HomePage from './home'
import LogsPage from './logs'
import ProfilesPage from './profiles'
import ProxiesPage from './proxies'
import RulesPage from './rules'
import SettingsPage from './settings'
import UnlockPage from './unlock'

export const navItems = [
  {
    label: 'layout.components.navigation.tabs.home',
    path: '/',
    icon: [<HomeOutlinedIcon key="mui" />, <HomeSvg key="svg" />],
    Component: HomePage,
  },
  {
    label: 'layout.components.navigation.tabs.proxies',
    path: '/proxies',
    icon: [<WifiOutlinedIcon key="mui" />, <ProxiesSvg key="svg" />],
    Component: ProxiesPage,
  },
  {
    label: 'layout.components.navigation.tabs.profiles',
    path: '/profile',
    icon: [<DnsOutlinedIcon key="mui" />, <ProfilesSvg key="svg" />],
    Component: ProfilesPage,
  },
  {
    label: 'layout.components.navigation.tabs.connections',
    path: '/connections',
    icon: [<LanguageOutlinedIcon key="mui" />, <ConnectionsSvg key="svg" />],
    Component: ConnectionsPage,
  },
  {
    label: 'layout.components.navigation.tabs.rules',
    path: '/rules',
    icon: [<ForkRightOutlinedIcon key="mui" />, <RulesSvg key="svg" />],
    Component: RulesPage,
  },
  {
    label: 'layout.components.navigation.tabs.logs',
    path: '/logs',
    icon: [<SubjectOutlinedIcon key="mui" />, <LogsSvg key="svg" />],
    Component: LogsPage,
  },
  {
    label: 'layout.components.navigation.tabs.unlock',
    path: '/unlock',
    icon: [<LockOpenOutlinedIcon key="mui" />, <UnlockSvg key="svg" />],
    Component: UnlockPage,
  },
  {
    label: 'layout.components.navigation.tabs.settings',
    path: '/settings',
    icon: [<SettingsOutlinedIcon key="mui" />, <SettingsSvg key="svg" />],
    Component: SettingsPage,
  },
]

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: navItems.map(
      (item) =>
        ({
          path: item.path,
          Component: item.Component,
        }) as RouteObject,
    ),
  },
])
