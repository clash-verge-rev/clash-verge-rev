import MetaIcon from "@/assets/image/Meta.svg?react";
import { BaseDialog, DialogRef } from "@/components/base";
import { useNotice } from "@/components/base/notifice";
import { useVerge } from "@/hooks/use-verge";
import {
  changeClashCore,
  grantPermissions,
  restartSidecar,
} from "@/services/cmds";
import { cn } from "@/utils";
import getSystem from "@/utils/get-system";
import { RestartAlt, SwitchAccessShortcut } from "@mui/icons-material";
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import { emit } from "@tauri-apps/api/event";
import { useLockFn } from "ahooks";
import { debounce } from "lodash-es";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { PulseLoader } from "react-spinners";
import { mutate } from "swr";
import {
  closeAllConnections,
  MihomoWebSocket,
  upgradeCore,
} from "tauri-plugin-mihomo-api";
import { useService } from "@/hooks/use-service";
import { useMihomoCoresInfo } from "@/hooks/use-mihomo-cores-info";
import { usePortable } from "@/hooks/use-portable";
import { useClash } from "@/hooks/use-clash";

interface Props {
  serviceActive: boolean;
}

const OS = getSystem();

export const ClashCoreViewer = forwardRef<DialogRef, Props>((props, ref) => {
  const { serviceActive } = props;
  const { t } = useTranslation();
  const { notice } = useNotice();
  const { verge, mutateVerge } = useVerge();
  const { clash_core = "verge-mihomo" } = verge;
  const { clash } = useClash();
  const { tun } = clash ?? {};
  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [changingCore, setChangingCore] = useState("");
  const { mihomoCoresInfo, refreshMihomoVersion, refreshMihomoPermissions } =
    useMihomoCoresInfo();
  const { serviceStatus } = useService();

  const { portable } = usePortable();
  const isLinuxPortable = portable && OS === "linux";
  const showGrantPermissions =
    isLinuxPortable &&
    (serviceStatus === "uninstall" || serviceStatus === "unknown");

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === clash_core) return;
    if (isLinuxPortable) {
      const enableTun = tun?.enable ?? false;
      const permissionsGranted =
        mihomoCoresInfo.find((info) => info.core === core)
          ?.permissionsGranted ?? false;
      if (enableTun && !permissionsGranted) {
        notice(
          "warning",
          t("Please grant permissions for _clash Core", { core: `${core}` }),
        );
        return;
      }
    }

    try {
      setChangingCore(core);
      closeAllConnections();
      await changeClashCore(core);
      mutateVerge();
      await MihomoWebSocket.cleanupAll();
      setTimeout(() => {
        mutate("getClashConfig");
        mutate("getVersion");
      }, 1000);
      notice(
        "success",
        t("Switched to _clash Core", { core: `${core}` }),
        1000,
      );
    } catch (err: any) {
      notice("error", err.message || err.toString());
    } finally {
      setChangingCore("");
    }
  });

  const onGrant = useLockFn(async (core: string) => {
    try {
      await grantPermissions(core);
      // 自动重启
      if (core === clash_core) await restartSidecar();
      notice(
        "success",
        t("Permissions Granted Successfully for _clash Core", {
          core: `${core}`,
        }),
        1000,
      );
    } catch (err: any) {
      notice("error", err.message || err.toString());
    } finally {
      await refreshMihomoPermissions();
    }
  });

  const onRestart = debounce(async () => {
    try {
      await restartSidecar();
      notice("success", t(`Clash Core Restarted`), 1000);
    } catch (err: any) {
      notice("error", err.message || err.toString());
    }
  }, 500);

  const onUpgrade = useLockFn(async () => {
    try {
      setUpgrading(true);
      await upgradeCore();
      setUpgrading(false);
      notice("success", t(`Core Version Updated`), 1000);
      setTimeout(async () => {
        await emit("verge://refresh-websocket");
      }, 2000);
    } catch (err: any) {
      setUpgrading(false);
      if (err.includes("already using latest version")) {
        notice("info", t("Currently on the Latest Version"), 1000);
      } else {
        notice("error", err.message || err.toString());
      }
    } finally {
      await refreshMihomoPermissions();
      await refreshMihomoVersion();
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("Clash Core")}
          <Box>
            <Button
              variant="contained"
              size="small"
              startIcon={<SwitchAccessShortcut />}
              loadingPosition="start"
              loading={upgrading}
              sx={{ marginRight: "8px" }}
              onClick={onUpgrade}>
              {t("Upgrade")}
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={onRestart}
              startIcon={<RestartAlt />}>
              {t("Restart")}
            </Button>
          </Box>
        </Box>
      }
      hideOkBtn
      hideCancelBtn
      contentStyle={{ minWidth: 480 }}
      onClose={() => setOpen(false)}>
      <List component="nav">
        {mihomoCoresInfo.map((each) => (
          <ListItemButton
            sx={{ pl: "2px" }}
            key={each.core}
            selected={each.core === clash_core}
            onClick={async () => {
              await onCoreChange(each.core);
            }}>
            <ListItemIcon>
              <div className="mx-1 flex w-24 flex-col items-center">
                <MetaIcon className="h-8 w-8" />
                <div className="bg-primary-alpha text-primary-main inline-block w-fit rounded-full px-2 py-[2px] text-[10px]">
                  {each.version}
                </div>
              </div>
            </ListItemIcon>
            <ListItemText
              primary={
                <div className="inline-flex items-center">
                  <span>{each.name}</span>
                  {showGrantPermissions && (
                    <div
                      className={cn(
                        "ml-2 inline-block rounded-full bg-red-600/60 px-2 py-[2px] text-[10px] text-white",
                        {
                          "bg-green-600/60": each.permissionsGranted,
                        },
                      )}>
                      {each.permissionsGranted
                        ? t("Granted")
                        : t("Not Granted")}
                    </div>
                  )}
                </div>
              }
              secondary={`/${each.core}`}
            />
            {changingCore === each.core && (
              <PulseLoader
                className="mr-4"
                size={6}
                color="var(--primary-main)"
              />
            )}

            {showGrantPermissions && (
              <Button
                variant="outlined"
                size="small"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onGrant(each.core);
                }}>
                {each.permissionsGranted ? t("Re-Grant") : t("Grant")}
              </Button>
            )}
          </ListItemButton>
        ))}
      </List>
    </BaseDialog>
  );
});
