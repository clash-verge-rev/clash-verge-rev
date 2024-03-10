import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, Button, Select, MenuItem } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice, Switch } from "@/components/base";
import { SettingItem } from "./setting-comp";
import { GuardState } from "./guard-state";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { convertFileSrc } from "@tauri-apps/api/tauri";
import { copyIconFile, getAppDir } from "@/services/cmds";
import { join } from "@tauri-apps/api/path";

export const LayoutViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [commonIcon, setCommonIcon] = useState("");
  const [sysproxyIcon, setSysproxyIcon] = useState("");
  const [tunIcon, setTunIcon] = useState("");

  // const { menu_icon } = verge ?? {};
  useEffect(() => {
    initIconPath();
  }, []);

  async function initIconPath() {
    const appDir = await getAppDir();
    const icon_dir = await join(appDir, "icons");
    const common_icon = await join(icon_dir, "common.png");
    const sysproxy_icon = await join(icon_dir, "sysproxy.png");
    const tun_icon = await join(icon_dir, "tun.png");
    setCommonIcon(common_icon);
    setSysproxyIcon(sysproxy_icon);
    setTunIcon(tun_icon);
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
      onCancel={() => setOpen(false)}
    >
      <List>
        <SettingItem label={t("Traffic Graph")}>
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
        </SettingItem>

        <SettingItem label={t("Memory Usage")}>
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
        </SettingItem>

        <SettingItem label={t("Proxy Group Icon")}>
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
        </SettingItem>

        <SettingItem label={t("Menu Icon")}>
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
        </SettingItem>

        <SettingItem label={t("Common Tray Icon")}>
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
                  const path = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png"],
                      },
                    ],
                  });
                  if (path?.length) {
                    await copyIconFile(`${path}`, "common.png");
                    onChangeData({ common_tray_icon: true });
                    patchVerge({ common_tray_icon: true });
                  }
                }
              }}
            >
              {verge?.common_tray_icon ? t("Clear") : t("Browse")}
            </Button>
          </GuardState>
        </SettingItem>

        <SettingItem label={t("System Proxy Tray Icon")}>
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
                  const path = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png"],
                      },
                    ],
                  });
                  if (path?.length) {
                    await copyIconFile(`${path}`, "sysproxy.png");
                    onChangeData({ sysproxy_tray_icon: true });
                    patchVerge({ sysproxy_tray_icon: true });
                  }
                }
              }}
            >
              {verge?.sysproxy_tray_icon ? t("Clear") : t("Browse")}
            </Button>
          </GuardState>
        </SettingItem>

        <SettingItem label={t("Tun Tray Icon")}>
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
                  const path = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png"],
                      },
                    ],
                  });
                  if (path?.length) {
                    await copyIconFile(`${path}`, "tun.png");
                    onChangeData({ tun_tray_icon: true });
                    patchVerge({ tun_tray_icon: true });
                  }
                }
              }}
            >
              {verge?.tun_tray_icon ? t("Clear") : t("Browse")}
            </Button>
          </GuardState>
        </SettingItem>
      </List>
    </BaseDialog>
  );
});
