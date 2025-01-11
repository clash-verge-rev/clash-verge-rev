import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { Button, MenuItem, Select, Input, Typography } from "@mui/material";
import {
  exitApp,
  openAppDir,
  openCoreDir,
  openLogsDir,
  openDevTools,
  copyClashEnv,
} from "@/services/cmds";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { useVerge } from "@/hooks/use-verge";
import { version } from "@root/package.json";
import { DialogRef, Notice } from "@/components/base";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { ThemeModeSwitch } from "./mods/theme-mode-switch";
import { ConfigViewer } from "./mods/config-viewer";
import { HotkeyViewer } from "./mods/hotkey-viewer";
import { MiscViewer } from "./mods/misc-viewer";
import { ThemeViewer } from "./mods/theme-viewer";
import { GuardState } from "./mods/guard-state";
import { LayoutViewer } from "./mods/layout-viewer";
import { UpdateViewer } from "./mods/update-viewer";
import { BackupViewer } from "./mods/backup-viewer";
import getSystem from "@/utils/get-system";
import { routers } from "@/pages/_routers";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { ContentCopyRounded } from "@mui/icons-material";
import { languages } from "@/services/i18n";

interface Props {
  onError?: (err: Error) => void;
}

const OS = getSystem();

const languageOptions = Object.entries(languages).map(([code, _]) => {
  const labels: { [key: string]: string } = {
    en: "English",
    ru: "Русский",
    zh: "中文",
    fa: "فارسی",
    tt: "Татар",
    id: "Bahasa Indonesia",
    ar: "العربية",
  };
  return { code, label: labels[code] };
});

const SettingVerge = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { verge, patchVerge, mutateVerge } = useVerge();
  const {
    theme_mode,
    language,
    tray_event,
    env_type,
    startup_script,
    start_page,
  } = verge ?? {};
  const configRef = useRef<DialogRef>(null);
  const hotkeyRef = useRef<DialogRef>(null);
  const miscRef = useRef<DialogRef>(null);
  const themeRef = useRef<DialogRef>(null);
  const layoutRef = useRef<DialogRef>(null);
  const updateRef = useRef<DialogRef>(null);
  const backupRef = useRef<DialogRef>(null);

  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

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

  const onCopyClashEnv = useCallback(async () => {
    await copyClashEnv();
    Notice.success(t("Copy Success"), 1000);
  }, []);

  return (
    <SettingList title={t("Verge Setting")}>
      <ThemeViewer ref={themeRef} />
      <ConfigViewer ref={configRef} />
      <HotkeyViewer ref={hotkeyRef} />
      <MiscViewer ref={miscRef} />
      <LayoutViewer ref={layoutRef} />
      <UpdateViewer ref={updateRef} />
      <BackupViewer ref={backupRef} />

      <SettingItem label={t("Language")}>
        <GuardState
          value={language ?? "en"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ language: e })}
          onGuard={(e) => patchVerge({ language: e })}
        >
          <Select size="small" sx={{ width: 110, "> div": { py: "7.5px" } }}>
            {languageOptions.map(({ code, label }) => (
              <MenuItem key={code} value={code}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Theme Mode")}>
        <GuardState
          value={theme_mode}
          onCatch={onError}
          onChange={(e) => onChangeData({ theme_mode: e })}
          onGuard={(e) => patchVerge({ theme_mode: e })}
        >
          <ThemeModeSwitch />
        </GuardState>
      </SettingItem>

      {OS !== "linux" && (
        <SettingItem label={t("Tray Click Event")}>
          <GuardState
            value={tray_event ?? "main_window"}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeData({ tray_event: e })}
            onGuard={(e) => patchVerge({ tray_event: e })}
          >
            <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
              <MenuItem value="main_window">{t("Show Main Window")}</MenuItem>
              <MenuItem value="system_proxy">{t("System Proxy")}</MenuItem>
              <MenuItem value="tun_mode">{t("Tun Mode")}</MenuItem>
              <MenuItem value="disable">{t("Disable")}</MenuItem>
            </Select>
          </GuardState>
        </SettingItem>
      )}

      <SettingItem
        label={t("Copy Env Type")}
        extra={
          <TooltipIcon icon={ContentCopyRounded} onClick={onCopyClashEnv} />
        }
      >
        <GuardState
          value={env_type ?? (OS === "windows" ? "powershell" : "bash")}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ env_type: e })}
          onGuard={(e) => patchVerge({ env_type: e })}
        >
          <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
            <MenuItem value="bash">Bash</MenuItem>
            <MenuItem value="cmd">CMD</MenuItem>
            <MenuItem value="nushell">Nushell</MenuItem>
            <MenuItem value="powershell">PowerShell</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Start Page")}>
        <GuardState
          value={start_page ?? "/"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ start_page: e })}
          onGuard={(e) => patchVerge({ start_page: e })}
        >
          <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
            {routers.map((page: { label: string; path: string }) => {
              return <MenuItem value={page.path}>{t(page.label)}</MenuItem>;
            })}
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Startup Script")}>
        <GuardState
          value={startup_script ?? ""}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ startup_script: e })}
          onGuard={(e) => patchVerge({ startup_script: e })}
        >
          <Input
            value={startup_script}
            disabled
            sx={{ width: 230 }}
            endAdornment={
              <>
                <Button
                  onClick={async () => {
                    const selected = await open({
                      directory: false,
                      multiple: false,
                      filters: [
                        {
                          name: "Shell Script",
                          extensions: ["sh", "bat", "ps1"],
                        },
                      ],
                    });
                    if (selected) {
                      onChangeData({ startup_script: `${selected}` });
                      patchVerge({ startup_script: `${selected}` });
                    }
                  }}
                >
                  {t("Browse")}
                </Button>
                {startup_script && (
                  <Button
                    onClick={async () => {
                      onChangeData({ startup_script: "" });
                      patchVerge({ startup_script: "" });
                    }}
                  >
                    {t("Clear")}
                  </Button>
                )}
              </>
            }
          ></Input>
        </GuardState>
      </SettingItem>

      <SettingItem
        onClick={() => themeRef.current?.open()}
        label={t("Theme Setting")}
      />

      <SettingItem
        onClick={() => layoutRef.current?.open()}
        label={t("Layout Setting")}
      />

      <SettingItem
        onClick={() => miscRef.current?.open()}
        label={t("Miscellaneous")}
      />

      <SettingItem
        onClick={() => hotkeyRef.current?.open()}
        label={t("Hotkey Setting")}
      />

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
        onClick={() => {
          exitApp();
        }}
        label={t("Exit")}
      />

      <SettingItem label={t("Verge Version")}>
        <Typography sx={{ py: "7px", pr: 1 }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVerge;
