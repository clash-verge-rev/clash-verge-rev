import LogsPage from "./logs";
import ProxiesPage from "./proxies";
import TestPage from "./test";
import ProfilesPage from "./profiles";
import SettingsPage from "./settings";
import ConnectionsPage from "./connections";
import RulesPage from "./rules";

import ProxiesSvg from "@/assets/image/itemicon/proxies.svg?react";
import ProfilesSvg from "@/assets/image/itemicon/profiles.svg?react";
import ConnectionsSvg from "@/assets/image/itemicon/connections.svg?react";
import RulesSvg from "@/assets/image/itemicon/rules.svg?react";
import LogsSvg from "@/assets/image/itemicon/logs.svg?react";
import TestSvg from "@/assets/image/itemicon/test.svg?react";
import SettingsSvg from "@/assets/image/itemicon/settings.svg?react";

import WifiRoundedIcon from "@mui/icons-material/WifiRounded";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import LanguageRoundedIcon from "@mui/icons-material/LanguageRounded";
import ForkRightRoundedIcon from "@mui/icons-material/ForkRightRounded";
import SubjectRoundedIcon from "@mui/icons-material/SubjectRounded";
import WifiTetheringRoundedIcon from "@mui/icons-material/WifiTetheringRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";

export const routers = [
  {
    label: "Label-Proxies",
    link: "/",
    icon: [<WifiRoundedIcon />, <ProxiesSvg />],
    ele: ProxiesPage,
  },
  {
    label: "Label-Profiles",
    link: "/profile",
    icon: [<DnsRoundedIcon />, <ProfilesSvg />],
    ele: ProfilesPage,
  },
  {
    label: "Label-Connections",
    link: "/connections",
    icon: [<LanguageRoundedIcon />, <ConnectionsSvg />],
    ele: ConnectionsPage,
  },
  {
    label: "Label-Rules",
    link: "/rules",
    icon: [<ForkRightRoundedIcon />, <RulesSvg />],
    ele: RulesPage,
  },
  {
    label: "Label-Logs",
    link: "/logs",
    icon: [<SubjectRoundedIcon />, <LogsSvg />],
    ele: LogsPage,
  },
  {
    label: "Label-Test",
    link: "/test",
    icon: [<WifiTetheringRoundedIcon />, <TestSvg />],
    ele: TestPage,
  },
  {
    label: "Label-Settings",
    link: "/settings",
    icon: [<SettingsRoundedIcon />, <SettingsSvg />],
    ele: SettingsPage,
  },
];
