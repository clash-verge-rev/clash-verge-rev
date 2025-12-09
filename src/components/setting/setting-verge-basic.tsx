import { ContentCopyRounded } from "@mui/icons-material";
import { Button, Input, MenuItem, Select } from "@mui/material";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

import { DialogRef } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { useVerge } from "@/hooks/use-verge";
import { navItems } from "@/pages/_routers";
import { copyClashEnv } from "@/services/cmds";
import { supportedLanguages } from "@/services/i18n";
import { showNotice } from "@/services/notice-service";
import getSystem from "@/utils/get-system";

import { BackupViewer } from "./mods/backup-viewer";
import { ConfigViewer } from "./mods/config-viewer";
import { GuardState } from "./mods/guard-state";
import { HotkeyViewer } from "./mods/hotkey-viewer";
import { LayoutViewer } from "./mods/layout-viewer";
import { MiscViewer } from "./mods/misc-viewer";
import { SettingItem, SettingList } from "./mods/setting-comp";
import { ThemeModeSwitch } from "./mods/theme-mode-switch";
import { ThemeViewer } from "./mods/theme-viewer";
import { UpdateViewer } from "./mods/update-viewer";

interface Props {
  onError?: (err: Error) => void;
}

const OS = getSystem();

const languageOptions = supportedLanguages.map((code) => {
  const labels: { [key: string]: string } = {
    en: "English",
    ru: "Русский",
    zh: "中文",
    fa: "فارسی",
    tt: "Татар",
    id: "Bahasa Indonesia",
    ar: "العربية",
    ko: "한국어",
    tr: "Türkçe",
    de: "Deutsch",
    es: "Español",
    jp: "日本語",
    zhtw: "繁體中文",
  };
  const label = labels[code] || code;
  return { code, label };
});

const SettingVergeBasic = ({ onError }: Props) => {
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

  const onChangeData = (patch: any) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  const onCopyClashEnv = useCallback(async () => {
    await copyClashEnv();
    showNotice.success(
      "shared.feedback.notifications.common.copySuccess",
      1000,
    );
  }, []);

  return (
    <SettingList title={t("settings.components.verge.basic.title")}>
      <ThemeViewer ref={themeRef} />
      <ConfigViewer ref={configRef} />
      <HotkeyViewer ref={hotkeyRef} />
      <MiscViewer ref={miscRef} />
      <LayoutViewer ref={layoutRef} />
      <UpdateViewer ref={updateRef} />
      <BackupViewer ref={backupRef} />

      <SettingItem label={t("settings.components.verge.basic.fields.language")}>
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

      <SettingItem
        label={t("settings.components.verge.basic.fields.themeMode")}
      >
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
        <SettingItem
          label={t("settings.components.verge.basic.fields.trayClickEvent")}
        >
          <GuardState
            value={tray_event ?? "main_window"}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeData({ tray_event: e })}
            onGuard={(e) => patchVerge({ tray_event: e })}
          >
            <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
              <MenuItem value="main_window">
                {t(
                  "settings.components.verge.basic.trayOptions.showMainWindow",
                )}
              </MenuItem>
              <MenuItem value="tray_menu">
                {t("settings.components.verge.basic.trayOptions.showTrayMenu")}
              </MenuItem>
              <MenuItem value="system_proxy">
                {t("settings.sections.system.toggles.systemProxy")}
              </MenuItem>
              <MenuItem value="tun_mode">
                {t("settings.sections.system.toggles.tunMode")}
              </MenuItem>
              <MenuItem value="disable">
                {t("settings.components.verge.basic.trayOptions.disable")}
              </MenuItem>
            </Select>
          </GuardState>
        </SettingItem>
      )}

      <SettingItem
        label={t("settings.components.verge.basic.fields.copyEnvType")}
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
            <MenuItem value="fish">Fish</MenuItem>
            <MenuItem value="nushell">Nushell</MenuItem>
            <MenuItem value="cmd">CMD</MenuItem>
            <MenuItem value="powershell">PowerShell</MenuItem>
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("settings.components.verge.basic.fields.startPage")}
      >
        <GuardState
          value={start_page ?? "/"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ start_page: e })}
          onGuard={(e) => patchVerge({ start_page: e })}
        >
          <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
            {navItems.map((page: { label: string; path: string }) => {
              return (
                <MenuItem key={page.path} value={page.path}>
                  {t(page.label)}
                </MenuItem>
              );
            })}
          </Select>
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("settings.components.verge.basic.fields.startupScript")}
      >
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
            disableUnderline
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
                  {t("settings.components.verge.basic.actions.browse")}
                </Button>
                {startup_script && (
                  <Button
                    onClick={async () => {
                      onChangeData({ startup_script: "" });
                      patchVerge({ startup_script: "" });
                    }}
                  >
                    {t("shared.actions.clear")}
                  </Button>
                )}
              </>
            }
          ></Input>
        </GuardState>
      </SettingItem>

      <SettingItem
        onClick={() => themeRef.current?.open()}
        label={t("settings.components.verge.basic.fields.themeSetting")}
      />

      <SettingItem
        onClick={() => layoutRef.current?.open()}
        label={t("settings.components.verge.basic.fields.layoutSetting")}
      />

      <SettingItem
        onClick={() => miscRef.current?.open()}
        label={t("settings.components.verge.basic.fields.misc")}
      />

      <SettingItem
        onClick={() => hotkeyRef.current?.open()}
        label={t("settings.components.verge.basic.fields.hotkeySetting")}
      />
    </SettingList>
  );
};

export default SettingVergeBasic;
