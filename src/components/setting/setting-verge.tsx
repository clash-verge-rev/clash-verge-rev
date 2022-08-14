import useSWR from "swr";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  IconButton,
  MenuItem,
  Select,
  Switch,
  Typography,
} from "@mui/material";
import {
  getVergeConfig,
  openAppDir,
  openLogsDir,
  patchVergeConfig,
} from "@/services/cmds";
import { ArrowForward } from "@mui/icons-material";
import { SettingList, SettingItem } from "./setting";
import { version } from "@root/package.json";
import ThemeModeSwitch from "./mods/theme-mode-switch";
import ConfigViewer from "./mods/config-viewer";
import GuardState from "./mods/guard-state";
import SettingTheme from "./setting-theme";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVerge = ({ onError }: Props) => {
  const { t } = useTranslation();
  const { data: vergeConfig, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    getVergeConfig
  );

  const { theme_mode, theme_blur, traffic_graph, language } = vergeConfig ?? {};

  const [themeOpen, setThemeOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutateVerge({ ...vergeConfig, ...patch }, false);
  };

  return (
    <SettingList title={t("Verge Setting")}>
      <SettingItem label={t("Language")}>
        <GuardState
          value={language ?? "en"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ language: e })}
          onGuard={(e) => patchVergeConfig({ language: e })}
        >
          <Select size="small" sx={{ width: 100, "> div": { py: "7.5px" } }}>
            <MenuItem value="zh">中文</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Theme Mode")}>
        <GuardState
          value={theme_mode}
          onCatch={onError}
          onChange={(e) => onChangeData({ theme_mode: e })}
          onGuard={(e) => patchVergeConfig({ theme_mode: e })}
        >
          <ThemeModeSwitch />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Theme Blur")}>
        <GuardState
          value={theme_blur ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ theme_blur: e })}
          onGuard={(e) => patchVergeConfig({ theme_blur: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Traffic Graph")}>
        <GuardState
          value={traffic_graph ?? true}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ traffic_graph: e })}
          onGuard={(e) => patchVergeConfig({ traffic_graph: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Theme Setting")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => setThemeOpen(true)}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Runtime Config")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => setConfigOpen(true)}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Open App Dir")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={openAppDir}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Open Logs Dir")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={openLogsDir}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Verge Version")}>
        <Typography sx={{ py: "7px" }}>v{version}</Typography>
      </SettingItem>

      <SettingTheme open={themeOpen} onClose={() => setThemeOpen(false)} />
      <ConfigViewer open={configOpen} onClose={() => setConfigOpen(false)} />
    </SettingList>
  );
};

export default SettingVerge;
