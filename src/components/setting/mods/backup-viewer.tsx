import { LoadingButton } from "@mui/lab";
import {
  Button,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import type { ReactNode, Ref } from "react";
import { useCallback, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef } from "@/components/base";
import { createLocalBackup, createWebdavBackup } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

import { AutoBackupSettings } from "./auto-backup-settings";
import { BackupHistoryViewer } from "./backup-history-viewer";
import { BackupWebdavDialog } from "./backup-webdav-dialog";

type BackupSource = "local" | "webdav";

export function BackupViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<BackupSource | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySource, setHistorySource] = useState<BackupSource>("local");
  const [historyPage, setHistoryPage] = useState(0);
  const [webdavDialogOpen, setWebdavDialogOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const openHistory = (target: BackupSource) => {
    setHistorySource(target);
    setHistoryPage(0);
    setHistoryOpen(true);
  };

  const handleBackup = useLockFn(async (target: BackupSource) => {
    try {
      setBusyAction(target);
      if (target === "local") {
        await createLocalBackup();
        showNotice.success(
          "settings.modals.backup.messages.localBackupCreated",
        );
      } else {
        await createWebdavBackup();
        showNotice.success("settings.modals.backup.messages.backupCreated");
      }
    } catch (error) {
      console.error(error);
      showNotice.error(
        target === "local"
          ? "settings.modals.backup.messages.localBackupFailed"
          : "settings.modals.backup.messages.backupFailed",
        target === "local" ? undefined : { error },
      );
    } finally {
      setBusyAction(null);
    }
  });

  const setWebdavBusy = useCallback(
    (loading: boolean) => {
      setBusyAction(loading ? "webdav" : null);
    },
    [setBusyAction],
  );

  return (
    <BaseDialog
      open={open}
      title={t("settings.modals.backup.title")}
      contentSx={{ width: { xs: 360, sm: 520 } }}
      disableOk
      cancelBtn={t("shared.actions.close")}
      onCancel={() => setOpen(false)}
      onClose={() => setOpen(false)}
    >
      <Stack spacing={2}>
        <Stack
          spacing={1}
          sx={{
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
            p: 2,
          }}
        >
          <Typography variant="subtitle1">
            {t("settings.modals.backup.auto.title")}
          </Typography>
          <List disablePadding sx={{ ".MuiListItem-root": { px: 0 } }}>
            <AutoBackupSettings />
          </List>
        </Stack>

        <Stack
          spacing={1}
          sx={{
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
            p: 2,
          }}
        >
          <Typography variant="subtitle1">
            {t("settings.modals.backup.manual.title")}
          </Typography>
          <List disablePadding sx={{ ".MuiListItem-root": { px: 0 } }}>
            {(
              [
                {
                  key: "local" as BackupSource,
                  title: t("settings.modals.backup.tabs.local"),
                  description: t("settings.modals.backup.manual.local"),
                  actions: [
                    <LoadingButton
                      key="backup"
                      variant="contained"
                      size="small"
                      loading={busyAction === "local"}
                      onClick={() => handleBackup("local")}
                    >
                      {t("settings.modals.backup.actions.backup")}
                    </LoadingButton>,
                    <Button
                      key="history"
                      variant="outlined"
                      size="small"
                      onClick={() => openHistory("local")}
                    >
                      {t("settings.modals.backup.actions.viewHistory")}
                    </Button>,
                  ],
                },
                {
                  key: "webdav" as BackupSource,
                  title: t("settings.modals.backup.tabs.webdav"),
                  description: t("settings.modals.backup.manual.webdav"),
                  actions: [
                    <LoadingButton
                      key="backup"
                      variant="contained"
                      size="small"
                      loading={busyAction === "webdav"}
                      onClick={() => handleBackup("webdav")}
                    >
                      {t("settings.modals.backup.actions.backup")}
                    </LoadingButton>,
                    <Button
                      key="history"
                      variant="outlined"
                      size="small"
                      onClick={() => openHistory("webdav")}
                    >
                      {t("settings.modals.backup.actions.viewHistory")}
                    </Button>,
                    <Button
                      key="configure"
                      variant="text"
                      size="small"
                      onClick={() => setWebdavDialogOpen(true)}
                    >
                      {t("settings.modals.backup.manual.configureWebdav")}
                    </Button>,
                  ],
                },
              ] satisfies Array<{
                key: BackupSource;
                title: string;
                description: string;
                actions: ReactNode[];
              }>
            ).map((item, idx) => (
              <ListItem key={item.key} disableGutters divider={idx === 0}>
                <Stack spacing={1} sx={{ width: "100%" }}>
                  <ListItemText
                    primary={item.title}
                    slotProps={{ secondary: { component: "span" } }}
                    secondary={item.description}
                  />
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    flexWrap="wrap"
                    alignItems="center"
                  >
                    {item.actions}
                  </Stack>
                </Stack>
              </ListItem>
            ))}
          </List>
        </Stack>
      </Stack>

      <BackupHistoryViewer
        open={historyOpen}
        source={historySource}
        page={historyPage}
        onSourceChange={setHistorySource}
        onPageChange={setHistoryPage}
        onClose={() => setHistoryOpen(false)}
      />
      <BackupWebdavDialog
        open={webdavDialogOpen}
        onClose={() => setWebdavDialogOpen(false)}
        onBackupSuccess={() => openHistory("webdav")}
        setBusy={setWebdavBusy}
      />
    </BaseDialog>
  );
}
