import { mutate } from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useTranslation } from "react-i18next";
import { useVerge } from "@/hooks/use-verge";
import { useLockFn } from "ahooks";
import { LoadingButton } from "@mui/lab";
import {
  SwitchAccessShortcutRounded,
  RestartAltRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { changeClashCore, restartCore } from "@/services/cmds";
import { closeAllConnections, upgradeCore } from "@/services/api";

const VALID_CORE = [
  { name: "Mihomo", core: "verge-mihomo", chip: "Release Version" },
  { name: "Mihomo Alpha", core: "verge-mihomo-alpha", chip: "Alpha Version" },
];

export const ClashCoreViewer = forwardRef<DialogRef>((props, ref) => {
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

  const onRestart = useLockFn(async () => {
    try {
      await restartCore();
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
              startIcon={<SwitchAccessShortcutRounded />}
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
              startIcon={<RestartAltRounded />}
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
      cancelBtn={t("Close")}
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
            <Chip label={t(`${each.chip}`)} size="small" />
          </ListItemButton>
        ))}
      </List>
    </BaseDialog>
  );
});
