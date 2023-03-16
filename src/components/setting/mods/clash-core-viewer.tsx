import { mutate } from "swr";
import { forwardRef, useImperativeHandle, useState } from "react";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useTranslation } from "react-i18next";
import { useVerge } from "@/hooks/use-verge";
import { useLockFn } from "ahooks";
import { Lock } from "@mui/icons-material";
import {
  Box,
  Button,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { changeClashCore, restartSidecar } from "@/services/cmds";
import { closeAllConnections } from "@/services/api";
import { grantPermission } from "@/services/cmds";
import getSystem from "@/utils/get-system";

const VALID_CORE = [
  { name: "Clash", core: "clash" },
  { name: "Clash Meta", core: "clash-meta" },
];

const OS = getSystem();

export const ClashCoreViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const { verge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const { clash_core = "clash" } = verge ?? {};

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
      Notice.success(`Successfully switch to ${core}`, 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onGrant = useLockFn(async (core: string) => {
    try {
      await grantPermission(core);
      // 自动重启
      if (core === clash_core) await restartSidecar();
      Notice.success(`Successfully grant permission to ${core}`, 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onRestart = useLockFn(async () => {
    try {
      await restartSidecar();
      Notice.success(`Successfully restart core`, 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("Clash Core")}

          <Button variant="contained" size="small" onClick={onRestart}>
            {t("Restart")}
          </Button>
        </Box>
      }
      contentSx={{
        pb: 0,
        width: 320,
        height: 200,
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
              <IconButton
                color="inherit"
                size="small"
                edge="end"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onGrant(each.core);
                }}
              >
                <Lock fontSize="inherit" />
              </IconButton>
            )}
          </ListItemButton>
        ))}
      </List>
    </BaseDialog>
  );
});
