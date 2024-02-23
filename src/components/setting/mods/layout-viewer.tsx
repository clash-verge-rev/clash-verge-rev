import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, Switch, Button } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { SettingItem } from "./setting-comp";
import { GuardState } from "./guard-state";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { convertFileSrc } from "@tauri-apps/api/tauri";

export const LayoutViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);

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
                verge?.common_tray_icon && (
                  <img
                    height="20px"
                    src={convertFileSrc(verge?.common_tray_icon)}
                  />
                )
              }
              onClick={async () => {
                if (verge?.common_tray_icon) {
                  onChangeData({ common_tray_icon: "" });
                  patchVerge({ common_tray_icon: "" });
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
                    onChangeData({ common_tray_icon: `${path}` });
                    patchVerge({ common_tray_icon: `${path}` });
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
                verge?.sysproxy_tray_icon && (
                  <img
                    height="20px"
                    src={convertFileSrc(verge?.sysproxy_tray_icon)}
                  />
                )
              }
              onClick={async () => {
                if (verge?.sysproxy_tray_icon) {
                  onChangeData({ sysproxy_tray_icon: "" });
                  patchVerge({ sysproxy_tray_icon: "" });
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
                    onChangeData({ sysproxy_tray_icon: `${path}` });
                    patchVerge({ sysproxy_tray_icon: `${path}` });
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
                verge?.tun_tray_icon && (
                  <img
                    height="20px"
                    src={convertFileSrc(verge?.tun_tray_icon)}
                  />
                )
              }
              onClick={async () => {
                if (verge?.tun_tray_icon) {
                  onChangeData({ tun_tray_icon: "" });
                  patchVerge({ tun_tray_icon: "" });
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
                    onChangeData({ tun_tray_icon: `${path}` });
                    patchVerge({ tun_tray_icon: `${path}` });
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
