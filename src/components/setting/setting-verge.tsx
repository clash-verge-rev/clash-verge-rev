import { DialogRef, Notice } from "@/components/base";
import {
  WebDavFilesViewer,
  WebDavFilesViewerRef,
} from "@/components/setting/mods/webdav-files-viewer";
import { useVerge } from "@/hooks/use-verge";
import { routers } from "@/pages/_routers";
import {
  createAndUploadBackup,
  exitApp,
  openAppDir,
  openCoreDir,
  openDevTools,
  openLogsDir,
  updateWebDavInfo,
} from "@/services/cmds";
import getSystem from "@/utils/get-system";
import {
  Check,
  CloudUpload,
  Refresh,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import {
  Button,
  Checkbox,
  Collapse,
  FormControlLabel,
  IconButton,
  Input,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { version } from "@root/package.json";
import { open } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
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
    webdav_url,
    webdav_username,
    webdav_password,
  } = verge ?? {};
  const configRef = useRef<DialogRef>(null);
  const hotkeyRef = useRef<DialogRef>(null);
  const miscRef = useRef<DialogRef>(null);
  const themeRef = useRef<DialogRef>(null);
  const layoutRef = useRef<DialogRef>(null);
  const updateRef = useRef<DialogRef>(null);
  const webDavRef = useRef<WebDavFilesViewerRef>(null);

  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  const onCheckUpdate = async () => {
    try {
      const info = await check();
      if (!info?.available) {
        Notice.success(t("Currently on the Latest Version"));
      } else {
        updateRef.current?.open();
      }
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  };

  const [expand, setExpand] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, watch, reset } = useForm<IWebDavConfig>({
    defaultValues: {
      url: webdav_url,
      username: webdav_username,
      password: webdav_password,
    },
  });

  // web dav setting
  const [saving, setSaving] = useState(false);
  const [onlyBackupProfiles, setOnlyBackupProfiles] = useState(false);
  const [loadingBackupFiles, setLoadingBackupFiles] = useState(false);
  const [startingBackup, setStartingBackup] = useState(false);

  const url = watch("url");
  const username = watch("username");
  const password = watch("password");
  const webdavChanged =
    webdav_url !== url ||
    webdav_username !== username ||
    webdav_password !== password;

  const onSubmit = async (data: IWebDavConfig) => {
    try {
      if (webdavChanged) {
        setSaving(true);
        await patchVerge({
          webdav_url: data.url,
          webdav_username: data.username,
          webdav_password: data.password,
        });
        await updateWebDavInfo(data.url, data.username, data.password);
      } else {
        setLoadingBackupFiles(true);
        await webDavRef.current?.getAllBackupFiles();
        webDavRef.current?.open();
      }
    } catch (e: any) {
      Notice.error(t("WebDav Connection Failed", { error: e }), 3000);
    } finally {
      setSaving(false);
      setLoadingBackupFiles(false);
    }
  };

  const handleBackup = async () => {
    try {
      setStartingBackup(true);
      await createAndUploadBackup(false, onlyBackupProfiles);
      Notice.success(t("Backup Successful"));
    } catch (e) {
      Notice.error(t("Backup Failed", { error: e }), 3000);
    } finally {
      setStartingBackup(false);
    }
  };

  return (
    <SettingList title={t("Verge Setting")}>
      <ThemeViewer ref={themeRef} />
      <ConfigViewer ref={configRef} />
      <HotkeyViewer ref={hotkeyRef} />
      <MiscViewer ref={miscRef} />
      <LayoutViewer ref={layoutRef} />
      <UpdateViewer ref={updateRef} />
      <WebDavFilesViewer ref={webDavRef} />

      <SettingItem label={t("Language")}>
        <GuardState
          value={language ?? "en"}
          onCatch={onError}
          onFormat={(e: any) => e.target.value}
          onChange={(e) => onChangeData({ language: e })}
          onGuard={(e) => patchVerge({ language: e })}>
          <Select size="small" sx={{ width: 110, "> div": { py: "7.5px" } }}>
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
          onGuard={(e) => patchVerge({ theme_mode: e })}>
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
            onGuard={(e) => patchVerge({ tray_event: e })}>
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
          onGuard={(e) => patchVerge({ env_type: e })}>
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
          onGuard={(e) => patchVerge({ start_page: e })}>
          <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
            {routers.map((page: { label: string; path: string }) => {
              return (
                <MenuItem key={page.path} value={page.path}>
                  {t(page.label)}
                </MenuItem>
              );
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
          onGuard={(e) => patchVerge({ startup_script: e })}>
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
                  }}>
                  {t("Browse")}
                </Button>
                {startup_script && (
                  <Button
                    onClick={async () => {
                      onChangeData({ startup_script: "" });
                      patchVerge({ startup_script: "" });
                    }}>
                    {t("Clear")}
                  </Button>
                )}
              </>
            }></Input>
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
        onClick={() => {
          if (expand && webdavChanged) {
            reset();
          }
          setExpand(!expand);
        }}
        label={t("WebDav Backup")}
        expand={expand}
      />

      <Collapse in={expand} timeout={"auto"} unmountOnExit>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="w-full bg-primary-alpha px-2">
          <TextField
            label={t("WebDav URL")}
            {...register("url")}
            size="small"
            fullWidth
            margin="normal"
            variant="outlined"
            autoComplete="off"
            autoCorrect="off"
          />
          <TextField
            label={t("WebDav Username")}
            {...register("username")}
            size="small"
            fullWidth
            margin="normal"
            variant="outlined"
            autoComplete="off"
            autoCorrect="off"
          />
          <TextField
            label={t("WebDav Password")}
            type={showPassword ? "text" : "password"}
            {...register("password")}
            size="small"
            fullWidth
            margin="normal"
            variant="outlined"
            autoComplete="off"
            autoCorrect="off"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      className="text-primary-main"
                      aria-label="toggle password visibility"
                      onClick={() => {
                        setShowPassword(!showPassword);
                      }}
                      edge="end">
                      {showPassword ? (
                        <Visibility fontSize="inherit" />
                      ) : (
                        <VisibilityOff fontSize="inherit" />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <div className="flex w-full items-center justify-end">
            <FormControlLabel
              className="mx-0"
              control={
                <Checkbox
                  checked={onlyBackupProfiles}
                  size="small"
                  onChange={(e) => setOnlyBackupProfiles(e.target.checked)}
                />
              }
              label={t("Only Backup Profiles")}
            />
          </div>
          <div className="flex w-full items-center justify-around space-x-4 pb-4 pt-2">
            {webdavChanged ? (
              <LoadingButton
                loading={saving}
                startIcon={<Check />}
                loadingPosition="start"
                type="submit"
                size="small"
                fullWidth
                variant="contained">
                {t("Save")}
              </LoadingButton>
            ) : (
              <>
                <LoadingButton
                  loading={loadingBackupFiles}
                  startIcon={<Refresh />}
                  loadingPosition="start"
                  type="submit"
                  size="small"
                  fullWidth
                  variant="contained">
                  {t("Recovery")}
                </LoadingButton>
                <LoadingButton
                  loading={startingBackup}
                  startIcon={<CloudUpload />}
                  loadingPosition="start"
                  size="small"
                  fullWidth
                  variant="contained"
                  onClick={() => handleBackup()}>
                  {t("Backup")}
                </LoadingButton>
              </>
            )}
          </div>
        </form>
      </Collapse>

      <SettingItem
        onClick={() => hotkeyRef.current?.open()}
        label={t("Hotkey Setting")}
      />

      <SettingItem
        onClick={() => configRef.current?.open()}
        label={t("Runtime Config")}
      />

      <SettingItem onClick={openAppDir} label={t("Open App Dir")} />

      <SettingItem onClick={openCoreDir} label={t("Open Core Dir")} />

      <SettingItem onClick={openLogsDir} label={t("Open Logs Dir")} />

      <SettingItem onClick={onCheckUpdate} label={t("Check for Updates")} />

      <SettingItem onClick={openDevTools} label={t("Open Dev Tools")} />

      <SettingItem onClick={() => exitApp()} label={t("Exit")} />

      <SettingItem label={t("Verge Version")}>
        <Typography sx={{ py: "7px", pr: 1 }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  );
};

export default SettingVerge;
