import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  List,
  Button,
  Select,
  MenuItem,
  styled,
  ListItem,
  ListItemText,
  Box,
} from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice, Switch } from "@/components/base";
import { GuardState } from "./guard-state";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { copyIconFile, getAppDir } from "@/services/cmds";
import { join } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";
import getSystem from "@/utils/get-system";

const OS = getSystem();

const getIcons = async (icon_dir: string, name: string) => {
  const updateTime = localStorage.getItem(`icon_${name}_update_time`) || "";

  const icon_png = await join(icon_dir, `${name}-${updateTime}.png`);
  const icon_ico = await join(icon_dir, `${name}-${updateTime}.ico`);

  return {
    icon_png,
    icon_ico,
  };
};

export const LayoutViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [commonIcon, setCommonIcon] = useState("");
  const [sysproxyIcon, setSysproxyIcon] = useState("");
  const [tunIcon, setTunIcon] = useState("");

  useEffect(() => {
    initIconPath();
  }, []);

  async function initIconPath() {
    const appDir = await getAppDir();

    const icon_dir = await join(appDir, "icons");

    const { icon_png: common_icon_png, icon_ico: common_icon_ico } =
      await getIcons(icon_dir, "common");

    const { icon_png: sysproxy_icon_png, icon_ico: sysproxy_icon_ico } =
      await getIcons(icon_dir, "sysproxy");

    const { icon_png: tun_icon_png, icon_ico: tun_icon_ico } = await getIcons(
      icon_dir,
      "tun",
    );

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
      cancelBtn={t("Close")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List>
        <Item>
          <ListItemText primary={t("Traffic Graph")} />
          <GuardState
            value={verge?.traffic_graph ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ traffic_graph: e })}
            onGuard={(e) => patchVerge({ traffic_graph: e })}
          >
            <Switch edge="end" />
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
            onGuard={(e) => patchVerge({ enable_memory_usage: e })}
          >
            <Switch edge="end" />
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
            onGuard={(e) => patchVerge({ enable_group_icon: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText primary={t("Nav Icon")} />
          <GuardState
            value={verge?.menu_icon ?? "monochrome"}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(e) => onChangeData({ menu_icon: e })}
            onGuard={(e) => patchVerge({ menu_icon: e })}
          >
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
              onGuard={(e) => patchVerge({ tray_icon: e })}
            >
              <Select
                size="small"
                sx={{ width: 140, "> div": { py: "7.5px" } }}
              >
                <MenuItem value="monochrome">{t("Monochrome")}</MenuItem>
                <MenuItem value="colorful">{t("Colorful")}</MenuItem>
              </Select>
            </GuardState>
          </Item>
        )}
        {OS === "macos" && (
          <Item>
            <ListItemText primary={t("Enable Tray Speed")} />
            <GuardState
              value={verge?.enable_tray_speed ?? true}
              valueProps="checked"
              onCatch={onError}
              onFormat={onSwitchFormat}
              onChange={(e) => onChangeData({ enable_tray_speed: e })}
              onGuard={(e) => patchVerge({ enable_tray_speed: e })}
            >
              <Switch edge="end" />
            </GuardState>
          </Item>
        )}

        <Item>
          <ListItemText primary={t("Common Tray Icon")} />
          <GuardState
            value={verge?.common_tray_icon}
            onCatch={onError}
            onChange={(e) => onChangeData({ common_tray_icon: e })}
            onGuard={(e) => patchVerge({ common_tray_icon: e })}
          >
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
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });

                  if (selected) {
                    await copyIconFile(`${selected}`, "common");
                    await initIconPath();
                    onChangeData({ common_tray_icon: true });
                    patchVerge({ common_tray_icon: true });
                    console.log();
                  }
                }
              }}
            >
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
            onGuard={(e) => patchVerge({ sysproxy_tray_icon: e })}
          >
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
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });
                  if (selected) {
                    await copyIconFile(`${selected}`, "sysproxy");
                    await initIconPath();
                    onChangeData({ sysproxy_tray_icon: true });
                    patchVerge({ sysproxy_tray_icon: true });
                  }
                }
              }}
            >
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
            onGuard={(e) => patchVerge({ tun_tray_icon: e })}
          >
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
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tun Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });
                  if (selected) {
                    await copyIconFile(`${selected}`, "tun");
                    await initIconPath();
                    onChangeData({ tun_tray_icon: true });
                    patchVerge({ tun_tray_icon: true });
                  }
                }
              }}
            >
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
