import { BaseDialog, DialogRef, Notice, SwitchLovely } from "@/components/base";
import { ConfirmViewer } from "@/components/profile/confirm-viewer";
import { GuardState } from "@/components/setting/mods/guard-state";
import { useVerge } from "@/hooks/use-verge";
import { copyIconFile, getAppDir, restartApp } from "@/services/cmds";
import getSystem from "@/utils/get-system";
import { InfoRounded } from "@mui/icons-material";
import {
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  styled,
  Tooltip,
} from "@mui/material";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { exists } from "@tauri-apps/api/fs";
import { join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

const OS = getSystem();

export const LayoutViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [commonIcon, setCommonIcon] = useState("");
  const [sysproxyIcon, setSysproxyIcon] = useState("");
  const [tunIcon, setTunIcon] = useState("");
  const { enable_system_title, enable_keep_ui_active, enable_splashscreen } =
    verge || {};
  const systemOS = getSystem();
  const show_title_setting = systemOS === "linux" || systemOS === "windows";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [enableSystemTitle, setEnableSystemTitle] = useState(
    enable_system_title ?? false,
  );
  useEffect(() => {
    initIconPath();
  }, []);

  async function initIconPath() {
    const appDir = await getAppDir();
    const icon_dir = await join(appDir, "icons");
    const common_icon_png = await join(icon_dir, "common.png");
    const common_icon_ico = await join(icon_dir, "common.ico");
    const sysproxy_icon_png = await join(icon_dir, "sysproxy.png");
    const sysproxy_icon_ico = await join(icon_dir, "sysproxy.ico");
    const tun_icon_png = await join(icon_dir, "tun.png");
    const tun_icon_ico = await join(icon_dir, "tun.ico");
    if (await exists(common_icon_ico)) {
      setCommonIcon(common_icon_ico);
    } else {
      setCommonIcon(common_icon_png);
    }
    if (await exists(sysproxy_icon_ico)) {
      setSysproxyIcon(sysproxy_icon_ico);
    } else {
      setSysproxyIcon(sysproxy_icon_png);
    }
    if (await exists(tun_icon_ico)) {
      setTunIcon(tun_icon_ico);
    } else {
      setTunIcon(tun_icon_png);
    }
  }

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onError = (err: any) => {
    Notice.error(err.message || err.toString());
  };
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  return (
    <BaseDialog
      open={open}
      title={t("Layout Setting")}
      contentSx={{ width: 450 }}
      disableOk
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}>
      <List>
        <Item>
          <ListItemText primary={t("Splashscreen")} />
          <GuardState
            value={enable_splashscreen ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_splashscreen: e })}
            onGuard={(e) => patchVerge({ enable_splashscreen: e })}>
            <SwitchLovely edge="end" />
          </GuardState>
        </Item>
        {show_title_setting && (
          <Item>
            <ListItemText primary={t("System Title")} />
            <Tooltip title={t("App Title Info")} placement="top">
              <IconButton color="inherit" size="small">
                <InfoRounded
                  fontSize="inherit"
                  style={{ cursor: "pointer", opacity: 0.75 }}
                />
              </IconButton>
            </Tooltip>
            <GuardState
              value={enable_system_title ?? false}
              valueProps="checked"
              onCatch={onError}
              onFormat={onSwitchFormat}
              onChange={(e) => {
                setConfirmOpen(true);
                setEnableSystemTitle(e);
              }}>
              <SwitchLovely edge="end" />
            </GuardState>
          </Item>
        )}

        <ConfirmViewer
          title={t("Confirm restart")}
          message={t("Restart App Message")}
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={async () => {
            onChangeData({ enable_system_title: enableSystemTitle });
            await patchVerge({ enable_system_title: enableSystemTitle });
            setConfirmOpen(false);
            restartApp();
          }}
        />

        <Item>
          <ListItemText primary={t("Keep UI Active")} />
          <Tooltip title={t("Keep UI Active Info")} placement="top">
            <IconButton color="inherit" size="small">
              <InfoRounded
                fontSize="inherit"
                style={{ cursor: "pointer", opacity: 0.75 }}
              />
            </IconButton>
          </Tooltip>
          <GuardState
            value={enable_keep_ui_active ?? false}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_keep_ui_active: e })}
            onGuard={(e) => patchVerge({ enable_keep_ui_active: e })}>
            <SwitchLovely edge="end" />
          </GuardState>
        </Item>
        <Item>
          <ListItemText primary={t("Traffic Graph")} />
          <GuardState
            value={verge?.traffic_graph ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ traffic_graph: e })}
            onGuard={(e) => patchVerge({ traffic_graph: e })}>
            <SwitchLovely edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText primary={t("Memory Usage")} />
          <GuardState
            value={verge?.enable_memory_usage ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_memory_usage: e })}
            onGuard={(e) => patchVerge({ enable_memory_usage: e })}>
            <SwitchLovely edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText primary={t("Proxy Group Icon")} />
          <GuardState
            value={verge?.enable_group_icon ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_group_icon: e })}
            onGuard={(e) => patchVerge({ enable_group_icon: e })}>
            <SwitchLovely edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText primary={t("Menu Icon")} />
          <GuardState
            value={verge?.menu_icon ?? "monochrome"}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeData({ menu_icon: e })}
            onGuard={(e) => patchVerge({ menu_icon: e })}>
            <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
              <MenuItem value="monochrome">{t("Monochrome")}</MenuItem>
              <MenuItem value="colorful">{t("Colorful")}</MenuItem>
              <MenuItem value="disable">{t("Disable")}</MenuItem>
            </Select>
          </GuardState>
        </Item>

        {OS === "macos" && (
          <Item>
            <ListItemText primary={t("Tray Icon")} />
            <GuardState
              value={verge?.tray_icon ?? "monochrome"}
              onCatch={onError}
              onFormat={(e: any) => e.target.value}
              onChange={(e) => onChangeData({ tray_icon: e })}
              onGuard={(e) => patchVerge({ tray_icon: e })}>
              <Select
                size="small"
                sx={{ width: 140, "> div": { py: "7.5px" } }}>
                <MenuItem value="monochrome">{t("Monochrome")}</MenuItem>
                <MenuItem value="colorful">{t("Colorful")}</MenuItem>
              </Select>
            </GuardState>
          </Item>
        )}

        <Item>
          <ListItemText primary={t("Common Tray Icon")} />
          <GuardState
            value={verge?.common_tray_icon}
            onCatch={onError}
            onChange={(e) => onChangeData({ common_tray_icon: e })}
            onGuard={(e) => patchVerge({ common_tray_icon: e })}>
            <Button
              variant="outlined"
              size="small"
              startIcon={
                verge?.common_tray_icon &&
                commonIcon && (
                  <img height="20px" src={convertFileSrc(commonIcon)} />
                )
              }
              onClick={async () => {
                if (verge?.common_tray_icon) {
                  onChangeData({ common_tray_icon: false });
                  patchVerge({ common_tray_icon: false });
                } else {
                  const path = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });
                  if (path?.length) {
                    await copyIconFile(`${path}`, "common");
                    await initIconPath();
                    onChangeData({ common_tray_icon: true });
                    patchVerge({ common_tray_icon: true });
                  }
                }
              }}>
              {verge?.common_tray_icon ? t("Clear") : t("Browse")}
            </Button>
          </GuardState>
        </Item>

        <Item>
          <ListItemText primary={t("System Proxy Tray Icon")} />
          <GuardState
            value={verge?.sysproxy_tray_icon}
            onCatch={onError}
            onChange={(e) => onChangeData({ sysproxy_tray_icon: e })}
            onGuard={(e) => patchVerge({ sysproxy_tray_icon: e })}>
            <Button
              variant="outlined"
              size="small"
              startIcon={
                verge?.sysproxy_tray_icon &&
                sysproxyIcon && (
                  <img height="20px" src={convertFileSrc(sysproxyIcon)} />
                )
              }
              onClick={async () => {
                if (verge?.sysproxy_tray_icon) {
                  onChangeData({ sysproxy_tray_icon: false });
                  patchVerge({ sysproxy_tray_icon: false });
                } else {
                  const path = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });
                  if (path?.length) {
                    await copyIconFile(`${path}`, "sysproxy");
                    await initIconPath();
                    onChangeData({ sysproxy_tray_icon: true });
                    patchVerge({ sysproxy_tray_icon: true });
                  }
                }
              }}>
              {verge?.sysproxy_tray_icon ? t("Clear") : t("Browse")}
            </Button>
          </GuardState>
        </Item>

        <Item>
          <ListItemText primary={t("Tun Tray Icon")} />
          <GuardState
            value={verge?.tun_tray_icon}
            onCatch={onError}
            onChange={(e) => onChangeData({ tun_tray_icon: e })}
            onGuard={(e) => patchVerge({ tun_tray_icon: e })}>
            <Button
              variant="outlined"
              size="small"
              startIcon={
                verge?.tun_tray_icon &&
                tunIcon && <img height="20px" src={convertFileSrc(tunIcon)} />
              }
              onClick={async () => {
                if (verge?.tun_tray_icon) {
                  onChangeData({ tun_tray_icon: false });
                  patchVerge({ tun_tray_icon: false });
                } else {
                  const path = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });
                  if (path?.length) {
                    await copyIconFile(`${path}`, "tun");
                    await initIconPath();
                    onChangeData({ tun_tray_icon: true });
                    patchVerge({ tun_tray_icon: true });
                  }
                }
              }}>
              {verge?.tun_tray_icon ? t("Clear") : t("Browse")}
            </Button>
          </GuardState>
        </Item>
      </List>
    </BaseDialog>
  );
});

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
}));
