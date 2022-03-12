import useSWR, { useSWRConfig } from "swr";
import { useTranslation } from "react-i18next";
import {
  IconButton,
  ListItemText,
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
} from "../../services/cmds";
import { ArrowForward } from "@mui/icons-material";
import { SettingList, SettingItem } from "./setting";
import { CmdType } from "../../services/types";
import { version } from "../../../package.json";
import PaletteSwitch from "./palette-switch";
import GuardState from "./guard-state";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVerge = ({ onError }: Props) => {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const { data: vergeConfig } = useSWR("getVergeConfig", getVergeConfig);

  const { theme_mode, theme_blur, traffic_graph, language } = vergeConfig ?? {};

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<CmdType.VergeConfig>) => {
    mutate("getVergeConfig", { ...vergeConfig, ...patch }, false);
  };

  return (
    <SettingList title={t("Verge Setting")}>
      <SettingItem>
        <ListItemText primary={t("Theme Mode")} />
        <GuardState
          value={theme_mode === "dark"}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ theme_mode: e ? "dark" : "light" })}
          onGuard={(e) =>
            patchVergeConfig({ theme_mode: e ? "dark" : "light" })
          }
        >
          <PaletteSwitch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary={t("Theme Blur")} />
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

      <SettingItem>
        <ListItemText primary={t("Traffic Graph")} />
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

      <SettingItem>
        <ListItemText primary={t("Language")} />
        <GuardState
          value={language ?? "en"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ language: e })}
          onGuard={(e) => patchVergeConfig({ language: e })}
        >
          <Select size="small" sx={{ width: 100 }}>
            <MenuItem value="zh">中文</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem>
        <ListItemText primary={t("Open App Dir")} />
        <IconButton color="inherit" size="small" onClick={openAppDir}>
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem>
        <ListItemText primary={t("Open Logs Dir")} />
        <IconButton color="inherit" size="small" onClick={openLogsDir}>
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem>
        <ListItemText primary={t("Version")} />
        <Typography sx={{ py: "6px" }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVerge;
