import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import {
  changeClashCore,
  grantPermission,
  restartSidecar,
} from "@/services/cmds";
import getSystem from "@/utils/get-system";
import { RestartAlt, SwitchAccessShortcut } from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import {
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Tooltip,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
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

  const { verge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const { clash_core = "verge-mihomo" } = verge ?? {};

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === clash_core) return;

    try {
      closeAllConnections();
      await changeClashCore(core);
      mutateVerge();
      setTimeout(() => {
        mutate("getClashConfig");
        mutate("getVersion");
      }, 100);
      Notice.success(t("Switched to _clash Core", { core: `${core}` }), 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onGrant = useLockFn(async (core: string) => {
    try {
      await grantPermission(core);
      // 自动重启
      if (core === clash_core) await restartSidecar();
      Notice.success(
        t("Permissions Granted Successfully for _clash Core", {
          core: `${core}`,
        }),
        1000,
      );
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onRestart = useLockFn(async () => {
    try {
      await restartSidecar();
      Notice.success(t(`Clash Core Restarted`), 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onUpgrade = useLockFn(async () => {
    try {
      setUpgrading(true);
      await upgradeCore();
      setUpgrading(false);
      Notice.success(t(`Core Version Updated`), 1000);
    } catch (err: any) {
      setUpgrading(false);
      if (err.includes("already using latest version")) {
        Notice.info(t("Currently on the Latest Version"), 1000);
      } else {
        Notice.error(err);
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
            <LoadingButton
              variant="contained"
              size="small"
              startIcon={<SwitchAccessShortcut />}
              loadingPosition="start"
              loading={upgrading}
              sx={{ marginRight: "8px" }}
              onClick={onUpgrade}>
              {t("Upgrade")}
            </LoadingButton>
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
      cancelBtn={t("Back")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}>
      <List component="nav">
        {VALID_CORE.map((each) => (
          <ListItemButton
            key={each.core}
            selected={each.core === clash_core}
            onClick={() => onCoreChange(each.core)}>
            <ListItemText primary={each.name} secondary={`/${each.core}`} />

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
