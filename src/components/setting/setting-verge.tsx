import { useRef } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/api/dialog";
import {
  Button,
  IconButton,
  MenuItem,
  Select,
  Input,
  Typography,
} from "@mui/material";
import {
  exitApp,
  openAppDir,
  openCoreDir,
  openLogsDir,
  openDevTools,
} from "@/services/cmds";
import { ArrowForward } from "@mui/icons-material";
import { checkUpdate } from "@tauri-apps/api/updater";
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
import getSystem from "@/utils/get-system";
import { routers } from "@/pages/_routers";

interface Props {
  onError?: (err: Error) => void;
}

const OS = getSystem();

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

  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  const onCheckUpdate = useLockFn(async () => {
    try {
      const info = await checkUpdate();
      if (!info?.shouldUpdate) {
        Notice.success(t("Currently on the Latest Version"));
      } else {
        updateRef.current?.open();
      }
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <SettingList title={t("Verge Setting")}>
      <ThemeViewer ref={themeRef} />
      <ConfigViewer ref={configRef} />
      <HotkeyViewer ref={hotkeyRef} />
      <MiscViewer ref={miscRef} />
      <LayoutViewer ref={layoutRef} />
      <UpdateViewer ref={updateRef} />

      <SettingItem label={t("Language")}>
        <GuardState
          value={language ?? "en"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ language: e })}
          onGuard={(e) => patchVerge({ language: e })}
        >
          <Select size="small" sx={{ width: 100, "> div": { py: "7.5px" } }}>
            <MenuItem value="zh">中文</MenuItem>
            <MenuItem value="en">English</MenuItem>
            <MenuItem value="ru">Русский</MenuItem>
            <MenuItem value="fa">فارسی</MenuItem>
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

      <SettingItem label={t("Copy Env Type")}>
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
                    const path = await open({
                      directory: false,
                      multiple: false,
                      filters: [
                        {
                          name: "Shell Script",
                          extensions: ["sh", "bat", "ps1"],
                        },
                      ],
                    });
                    if (path?.length) {
                      onChangeData({ startup_script: `${path}` });
                      patchVerge({ startup_script: `${path}` });
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
      <SettingItem label={t("Theme Setting")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => themeRef.current?.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Layout Setting")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => layoutRef.current?.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Miscellaneous")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => miscRef.current?.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Hotkey Setting")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => hotkeyRef.current?.open()}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Runtime Config")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => configRef.current?.open()}
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

      <SettingItem label={t("Open Core Dir")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={openCoreDir}
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

      <SettingItem label={t("Check for Updates")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={onCheckUpdate}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Open Dev Tools")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={openDevTools}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Exit")}>
        <IconButton
          color="inherit"
          size="small"
          sx={{ my: "2px" }}
          onClick={() => {
            exitApp();
          }}
        >
          <ArrowForward />
        </IconButton>
      </SettingItem>

      <SettingItem label={t("Verge Version")}>
        <Typography sx={{ py: "7px", pr: 1 }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVerge;
