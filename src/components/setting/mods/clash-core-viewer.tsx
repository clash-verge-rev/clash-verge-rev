import {
  RestartAltRounded,
  SwitchAccessShortcutRounded,
} from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import {
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { useLockFn } from "ahooks";
import type { Ref } from "react";
import { useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";
import { closeAllConnections, upgradeCore } from "tauri-plugin-mihomo-api";

import { BaseDialog, DialogRef } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { changeClashCore, restartCore } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

const VALID_CORE = [
  {
    name: "Mihomo",
    core: "verge-mihomo",
    chipKey: "settings.modals.clashCore.variants.release",
  },
  {
    name: "Mihomo Alpha",
    core: "verge-mihomo-alpha",
    chipKey: "settings.modals.clashCore.variants.alpha",
  },
];

export function ClashCoreViewer({ ref }: { ref?: Ref<DialogRef> }) {
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
        showNotice.error(errorMsg);
        setChangingCore(null);
        return;
      }

      mutateVerge();
      setTimeout(async () => {
        mutate("getClashConfig");
        mutate("getVersion");
        setChangingCore(null);
      }, 500);
    } catch (err) {
      setChangingCore(null);
      showNotice.error(err);
    }
  });

  const onRestart = useLockFn(async () => {
    try {
      setRestarting(true);
      await restartCore();
      showNotice.success(
        t("settings.feedback.notifications.clash.restartSuccess"),
      );
      setRestarting(false);
    } catch (err) {
      setRestarting(false);
      showNotice.error(err);
    }
  });

  const onUpgrade = useLockFn(async () => {
    try {
      setUpgrading(true);
      await upgradeCore();
      setUpgrading(false);
      showNotice.success(
        t("settings.feedback.notifications.clash.versionUpdated"),
      );
    } catch (err: any) {
      setUpgrading(false);
      const errMsg = err?.response?.data?.message ?? String(err);
      const showMsg = errMsg.includes("already using latest version")
        ? t("settings.feedback.notifications.clash.alreadyLatestVersion")
        : errMsg;
      showNotice.info(showMsg);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("settings.sections.clash.form.fields.clashCore")}
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
              {t("shared.actions.upgrade")}
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
              {t("shared.actions.restart")}
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
      cancelBtn={t("shared.actions.close")}
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
              <Chip label={t(each.chipKey)} size="small" />
            )}
          </ListItemButton>
        ))}
      </List>
    </BaseDialog>
  );
}
