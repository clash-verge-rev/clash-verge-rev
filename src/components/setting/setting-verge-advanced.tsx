import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Typography } from "@mui/material";
import {
  exitApp,
  openAppDir,
  openCoreDir,
  openLogsDir,
  openDevTools,
  exportDiagnosticInfo,
} from "@/services/cmds";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { useVerge } from "@/hooks/use-verge";
import { version } from "@root/package.json";
import { DialogRef, Notice } from "@/components/base";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { ConfigViewer } from "./mods/config-viewer";
import { HotkeyViewer } from "./mods/hotkey-viewer";
import { MiscViewer } from "./mods/misc-viewer";
import { ThemeViewer } from "./mods/theme-viewer";
import { LayoutViewer } from "./mods/layout-viewer";
import { UpdateViewer } from "./mods/update-viewer";
import { BackupViewer } from "./mods/backup-viewer";
import { LiteModeViewer } from "./mods/lite-mode-viewer";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { ContentCopyRounded } from "@mui/icons-material";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVergeAdvanced = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { verge, patchVerge, mutateVerge } = useVerge();
  const configRef = useRef<DialogRef>(null);
  const hotkeyRef = useRef<DialogRef>(null);
  const miscRef = useRef<DialogRef>(null);
  const themeRef = useRef<DialogRef>(null);
  const layoutRef = useRef<DialogRef>(null);
  const updateRef = useRef<DialogRef>(null);
  const backupRef = useRef<DialogRef>(null);
  const liteModeRef = useRef<DialogRef>(null);

  const onCheckUpdate = async () => {
    try {
      const info = await checkUpdate();
      if (!info?.available) {
        Notice.success(t("Currently on the Latest Version"));
      } else {
        updateRef.current?.open();
      }
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  };

  const onExportDiagnosticInfo = useCallback(async () => {
    await exportDiagnosticInfo();
    Notice.success(t("Copy Success"), 1000);
  }, []);

  return (
    <SettingList title={t("Verge Advanced Setting")}>
      <ThemeViewer ref={themeRef} />
      <ConfigViewer ref={configRef} />
      <HotkeyViewer ref={hotkeyRef} />
      <MiscViewer ref={miscRef} />
      <LayoutViewer ref={layoutRef} />
      <UpdateViewer ref={updateRef} />
      <BackupViewer ref={backupRef} />
      <LiteModeViewer ref={liteModeRef} />

      <SettingItem
        onClick={() => backupRef.current?.open()}
        label={t("Backup Setting")}
        extra={
          <TooltipIcon
            title={t("Backup Setting Info")}
            sx={{ opacity: "0.7" }}
          />
        }
      />

      <SettingItem
        onClick={() => configRef.current?.open()}
        label={t("Runtime Config")}
      />

      <SettingItem
        onClick={openAppDir}
        label={t("Open Conf Dir")}
        extra={
          <TooltipIcon
            title={t("Open Conf Dir Info")}
            sx={{ opacity: "0.7" }}
          />
        }
      />

      <SettingItem onClick={openCoreDir} label={t("Open Core Dir")} />

      <SettingItem onClick={openLogsDir} label={t("Open Logs Dir")} />

      <SettingItem onClick={onCheckUpdate} label={t("Check for Updates")} />

      <SettingItem onClick={openDevTools} label={t("Open Dev Tools")} />

      <SettingItem
        label={t("LightWeight Mode Settings")}
        extra={
          <TooltipIcon title={t("LightWeight Mode Info")} sx={{ opacity: "0.7" }} />
        }
        onClick={() => liteModeRef.current?.open()}
      />

      <SettingItem
        onClick={() => {
          exitApp();
        }}
        label={t("Exit")}
      />

      <SettingItem
        label={t("Export Diagnostic Info")}
        extra={
          <TooltipIcon
            icon={ContentCopyRounded}
            onClick={onExportDiagnosticInfo}
          />
        }
      ></SettingItem>

      <SettingItem label={t("Verge Version")}>
        <Typography sx={{ py: "7px", pr: 1 }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVergeAdvanced;
