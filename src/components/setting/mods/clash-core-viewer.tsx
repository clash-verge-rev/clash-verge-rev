import { mutate } from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useTranslation } from "react-i18next";
import { useVerge } from "@/hooks/use-verge";
import { useLockFn } from "ahooks";
import { LoadingButton } from "@mui/lab";
import { SwitchAccessShortcut, RestartAlt } from "@mui/icons-material";
import {
  Box,
  Button,
  Tooltip,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { changeClashCore, restartSidecar } from "@/services/cmds";
import { closeAllConnections, upgradeCore } from "@/services/api";
import { grantPermission } from "@/services/cmds";
import getSystem from "@/utils/get-system";

const VALID_CORE = [
  { name: "Clash Meta", core: "clash-meta" },
  { name: "Clash Meta Alpha", core: "clash-meta-alpha" },
];

const OS = getSystem();

export const ClashCoreViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { verge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const { clash_core = "clash-meta" } = verge ?? {};

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
      Notice.success(t("Permissions Granted Successfully for _clash Core", { core: `${core}` }), 1000);
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
      Notice.error(err?.response.data.message || err.toString());
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
              onClick={onUpgrade}
            >
              {t("Upgrade")}
            </LoadingButton>
            <Button
              variant="contained"
              size="small"
              onClick={onRestart}
              startIcon={<RestartAlt />}
            >
              {t("Restart")}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{
        pb: 0,
        width: 400,
        height: 180,
        overflowY: "auto",
        userSelect: "text",
        marginTop: "-8px",
      }}
      disableOk
      cancelBtn={t("Back")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List component="nav">
        {VALID_CORE.map((each) => (
          <ListItemButton
            key={each.core}
            selected={each.core === clash_core}
            onClick={() => onCoreChange(each.core)}
          >
            <ListItemText primary={each.name} secondary={`/${each.core}`} />

            {(OS === "macos" || OS === "linux") && (
              <Tooltip title={t("Tun mode requires")}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onGrant(each.core);
                  }}
                >
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
