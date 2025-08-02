import MetaIcon from "@/assets/image/Meta.svg?react";
import { BaseDialog, DialogRef } from "@/components/base";
import { useNotice } from "@/components/base/notifice";
import { useVerge } from "@/hooks/use-verge";
import {
  changeClashCore,
  grantPermission,
  restartSidecar,
} from "@/services/cmds";
import getSystem from "@/utils/get-system";
import { RestartAlt, SwitchAccessShortcut } from "@mui/icons-material";
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from "@mui/material";
import { emit } from "@tauri-apps/api/event";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { PulseLoader } from "react-spinners";
import { mutate } from "swr";
import { closeAllConnections, upgradeCore } from "tauri-plugin-mihomo-api";

interface Props {
  serviceActive: boolean;
}

const VALID_CORE = [
  { name: "Mihomo", core: "verge-mihomo" },
  { name: "Mihomo Alpha", core: "verge-mihomo-alpha" },
];

const OS = getSystem();

export const ClashCoreViewer = forwardRef<DialogRef, Props>((props, ref) => {
  const { serviceActive } = props;
  const { t } = useTranslation();
  const { notice } = useNotice();

  const { verge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [changingCore, setChangingCore] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const { clash_core = "verge-mihomo" } = verge ?? {};
  const [currentCore, setCurrentCore] = useState(clash_core);

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === currentCore) return;

    try {
      setChangingCore(true);
      closeAllConnections();
      await changeClashCore(core);
      setCurrentCore(core);
      mutateVerge();
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
      notice("error", err?.message || err.toString());
    } finally {
      setChangingCore(false);
    }
  });

  const onGrant = useLockFn(async (core: string) => {
    try {
      await grantPermission(core);
      // 自动重启
      if (core === currentCore) await restartSidecar();
      notice(
        "success",
        t("Permissions Granted Successfully for _clash Core", {
          core: `${core}`,
        }),
        1000,
      );
    } catch (err: any) {
      notice("error", err?.message || err.toString());
    }
  });

  const onRestart = useLockFn(async () => {
    try {
      await restartSidecar();
      notice("success", t(`Clash Core Restarted`), 1000);
    } catch (err: any) {
      notice("error", err?.message || err.toString());
    }
  });

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
        notice("error", err?.message || err.toString());
      }
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
      onClose={() => setOpen(false)}>
      <List component="nav">
        {VALID_CORE.map((each) => (
          <ListItemButton
            key={each.core}
            selected={each.core === currentCore}
            onClick={async () => {
              await onCoreChange(each.core);
            }}>
            <ListItemIcon>
              <MetaIcon className="h-8 w-8" />
            </ListItemIcon>
            <ListItemText primary={each.name} secondary={`/${each.core}`} />
            {changingCore && each.core !== currentCore && (
              <PulseLoader
                className="mr-4"
                size={6}
                color="var(--primary-main)"
              />
            )}

            {(OS === "macos" || OS === "linux") && !serviceActive && (
              <Tooltip title={t("Update core requires")}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onGrant(each.core);
                  }}>
                  {t("Grant")}
                </Button>
              </Tooltip>
            )}
          </ListItemButton>
        ))}
      </List>
    </BaseDialog>
  );
});
