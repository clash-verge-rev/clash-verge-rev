import { ContentCopyRounded } from "@mui/icons-material";
import { Typography } from "@mui/material";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import { DialogRef } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import {
  exitApp,
  exportDiagnosticInfo,
  openAppDir,
  openCoreDir,
  openDevTools,
  openLogsDir,
} from "@/services/cmds";
import { createRawNotice, showNotice } from "@/services/noticeService";
import { checkUpdateSafe as checkUpdate } from "@/services/update";
import { version } from "@root/package.json";

import { BackupViewer } from "./mods/backup-viewer";
import { ConfigViewer } from "./mods/config-viewer";
import { HotkeyViewer } from "./mods/hotkey-viewer";
import { LayoutViewer } from "./mods/layout-viewer";
import { LiteModeViewer } from "./mods/lite-mode-viewer";
import { MiscViewer } from "./mods/misc-viewer";
import { SettingItem, SettingList } from "./mods/setting-comp";
import { ThemeViewer } from "./mods/theme-viewer";
import { UpdateViewer } from "./mods/update-viewer";

interface Props {
  onError?: (err: Error) => void;
}

const SettingVergeAdvanced = ({ onError: _ }: Props) => {
  const { t } = useTranslation();

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
        showNotice(
          "success",
          t("components.settings.verge.advanced.notifications.latestVersion"),
        );
      } else {
        updateRef.current?.open();
      }
    } catch (err: any) {
      showNotice("error", createRawNotice(err.message || err.toString()));
    }
  };

  const onExportDiagnosticInfo = useCallback(async () => {
    await exportDiagnosticInfo();
    showNotice(
      "success",
      t("components.settings.common.notifications.copySuccess"),
      1000,
    );
  }, [t]);

  const copyVersion = useCallback(() => {
    navigator.clipboard.writeText(`v${version}`).then(() => {
      showNotice(
        "success",
        t("components.settings.verge.advanced.notifications.versionCopied"),
        1000,
      );
    });
  }, [t]);

  return (
    <SettingList title={t("components.settings.verge.advanced.title")}>
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
        label={t("components.settings.verge.advanced.items.backupSetting")}
        extra={
          <TooltipIcon
            title={t("components.settings.verge.advanced.tooltips.backupInfo")}
            sx={{ opacity: "0.7" }}
          />
        }
      />

      <SettingItem
        onClick={() => configRef.current?.open()}
        label={t("components.settings.verge.advanced.items.runtimeConfig")}
      />

      <SettingItem
        onClick={openAppDir}
        label={t("components.settings.verge.advanced.items.openConfDir")}
        extra={
          <TooltipIcon
            title={t("components.settings.verge.advanced.tooltips.openConfDir")}
            sx={{ opacity: "0.7" }}
          />
        }
      />

      <SettingItem
        onClick={openCoreDir}
        label={t("components.settings.verge.advanced.items.openCoreDir")}
      />

      <SettingItem
        onClick={openLogsDir}
        label={t("components.settings.verge.advanced.items.openLogsDir")}
      />

      <SettingItem
        onClick={onCheckUpdate}
        label={t("components.settings.verge.advanced.items.checkUpdates")}
      />

      <SettingItem
        onClick={openDevTools}
        label={t("components.settings.verge.advanced.items.openDevTools")}
      />

      <SettingItem
        label={t("components.settings.verge.advanced.items.liteModeSettings")}
        extra={
          <TooltipIcon
            title={t("components.settings.verge.advanced.tooltips.liteMode")}
            sx={{ opacity: "0.7" }}
          />
        }
        onClick={() => liteModeRef.current?.open()}
      />

      <SettingItem
        onClick={() => {
          exitApp();
        }}
        label={t("components.settings.verge.advanced.items.exit")}
      />

      <SettingItem
        label={t("components.settings.verge.advanced.items.exportDiagnostics")}
        extra={
          <TooltipIcon
            icon={ContentCopyRounded}
            onClick={onExportDiagnosticInfo}
          />
        }
      ></SettingItem>

      <SettingItem
        label={t("components.settings.verge.advanced.items.vergeVersion")}
        extra={
          <TooltipIcon
            icon={ContentCopyRounded}
            onClick={copyVersion}
            title={t("components.settings.verge.advanced.actions.copyVersion")}
          />
        }
      >
        <Typography sx={{ py: "7px", pr: 1 }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVergeAdvanced;
