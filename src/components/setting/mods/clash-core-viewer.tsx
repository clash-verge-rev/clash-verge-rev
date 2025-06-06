import { mutate } from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { BaseDialog, DialogRef } from "@/components/base";
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
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { changeClashCore, restartCore } from "@/services/cmds";
import { closeAllConnections, upgradeCore } from "@/services/api";
import { showNotice } from "@/services/noticeService";

const VALID_CORE = [
  { name: "Mihomo", core: "verge-mihomo", chip: "Release Version" },
  { name: "Mihomo Alpha", core: "verge-mihomo-alpha", chip: "Alpha Version" },
];

export const ClashCoreViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { verge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [changingCore, setChangingCore] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const { clash_core = "verge-mihomo" } = verge ?? {};

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === clash_core) return;

    try {
      setChangingCore(core);
      closeAllConnections();
      const errorMsg = await changeClashCore(core);

      if (errorMsg) {
        showNotice("error", errorMsg);
        setChangingCore(null);
        return;
      }

      mutateVerge();
      setTimeout(() => {
        mutate("getClashConfig");
        mutate("getVersion");
        setChangingCore(null);
      }, 500);
    } catch (err: any) {
      setChangingCore(null);
      showNotice("error", err.message || err.toString());
    }
  });

  const onRestart = useLockFn(async () => {
    try {
      setRestarting(true);
      await restartCore();
      showNotice("success", t(`Clash Core Restarted`));
      setRestarting(false);
    } catch (err: any) {
      setRestarting(false);
      showNotice("error", err.message || err.toString());
    }
  });

  const onUpgrade = useLockFn(async () => {
    try {
      setUpgrading(true);
      await upgradeCore();
      setUpgrading(false);
      showNotice("success", t(`Core Version Updated`));
    } catch (err: any) {
      setUpgrading(false);
      const errMsg = err.response?.data?.message || err.toString();
      const showMsg = errMsg.includes("already using latest version")
        ? "Already Using Latest Core Version"
        : errMsg;
      showNotice("error", t(showMsg));
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
              disabled={restarting || changingCore !== null}
              sx={{ marginRight: "8px" }}
              onClick={onUpgrade}
            >
              {t("Upgrade")}
            </LoadingButton>
            <LoadingButton
              variant="contained"
              size="small"
              startIcon={<RestartAltRounded />}
              loadingPosition="start"
              loading={restarting}
              disabled={upgrading}
              onClick={onRestart}
            >
              {t("Restart")}
            </LoadingButton>
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
            disabled={changingCore !== null || restarting || upgrading}
          >
            <ListItemText primary={each.name} secondary={`/${each.core}`} />
            {changingCore === each.core ? (
              <CircularProgress size={20} sx={{ mr: 1 }} />
            ) : (
              <Chip label={t(`${each.chip}`)} size="small" />
            )}
          </ListItemButton>
        ))}
      </List>
    </BaseDialog>
  );
});
