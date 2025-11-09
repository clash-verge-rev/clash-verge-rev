import {
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import type { Ref } from "react";
import { useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, BaseLoadingOverlay, DialogRef } from "@/components/base";
import { createLocalBackup, createWebdavBackup } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

import { AutoBackupSettings } from "./auto-backup-settings";
import { BackupHistoryViewer } from "./backup-history-viewer";
import { BackupWebdavDialog } from "./backup-webdav-dialog";

type BackupSource = "local" | "webdav";

export function BackupViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const handleLocalBackup = useLockFn(async () => {
    try {
      setBusy(true);
      await createLocalBackup();
      showNotice.success("settings.modals.backup.messages.localBackupCreated");
    } catch (error) {
      console.error(error);
      showNotice.error("settings.modals.backup.messages.localBackupFailed");
    } finally {
      setBusy(false);
    }
  });

  const handleWebdavBackup = useLockFn(async () => {
    try {
      setBusy(true);
      await createWebdavBackup();
      showNotice.success("settings.modals.backup.messages.backupCreated");
    } catch (error) {
      console.error(error);
      showNotice.error("settings.modals.backup.messages.backupFailed", {
        error,
      });
    } finally {
      setBusy(false);
    }
  });

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
      <Box sx={{ position: "relative", minHeight: 300 }}>
        <BaseLoadingOverlay isLoading={busy} />
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={1.5}>
              <Typography variant="h6">
                {t("settings.modals.backup.auto.title")}
              </Typography>
              <AutoBackupSettings />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={1.5}>
              <Typography variant="h6">
                {t("settings.modals.backup.manual.title")}
              </Typography>
              <List disablePadding sx={{ ".MuiListItem-root": { px: 0 } }}>
                <ListItem
                  divider
                  secondaryAction={
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={handleLocalBackup}
                      >
                        {t("settings.modals.backup.actions.backup")}
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => openHistory("local")}
                      >
                        {t("settings.modals.backup.actions.viewHistory")}
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={t("settings.modals.backup.tabs.local")}
                    secondary={t("settings.modals.backup.manual.local")}
                  />
                </ListItem>
                <ListItem
                  secondaryAction={
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        size="small"
                        onClick={handleWebdavBackup}
                      >
                        {t("settings.modals.backup.actions.backup")}
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => openHistory("webdav")}
                      >
                        {t("settings.modals.backup.actions.viewHistory")}
                      </Button>
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => setWebdavDialogOpen(true)}
                      >
                        {t("settings.modals.backup.manual.configureWebdav")}
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={t("settings.modals.backup.tabs.webdav")}
                    secondary={t("settings.modals.backup.manual.webdav")}
                  />
                </ListItem>
              </List>
            </Stack>
          </Paper>
        </Stack>
      </Box>

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
        setBusy={setBusy}
      />
    </BaseDialog>
  );
}
