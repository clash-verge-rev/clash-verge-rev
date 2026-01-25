import { Box } from "@mui/material";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, BaseLoadingOverlay } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { listWebDavBackup } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import {
  buildWebdavSignature,
  setWebdavStatus,
} from "@/services/webdav-status";

import { BackupConfigViewer } from "./backup-config-viewer";

interface BackupWebdavDialogProps {
  open: boolean;
  onClose: () => void;
  onBackupSuccess?: () => void;
  setBusy?: (loading: boolean) => void;
}

export const BackupWebdavDialog = ({
  open,
  onClose,
  onBackupSuccess,
  setBusy,
}: BackupWebdavDialogProps) => {
  const { t } = useTranslation();
  const { verge } = useVerge();
  const [loading, setLoading] = useState(false);
  const webdavSignature = buildWebdavSignature(verge);

  const handleLoading = useCallback(
    (value: boolean) => {
      setLoading(value);
      setBusy?.(value);
    },
    [setBusy],
  );

  const refreshWebdav = useCallback(
    async (options?: { silent?: boolean; signature?: string }) => {
      const signature = options?.signature ?? webdavSignature;
      handleLoading(true);
      try {
        await listWebDavBackup();
        setWebdavStatus(signature, "ready");
        if (!options?.silent) {
          showNotice.success(
            "settings.modals.backup.messages.webdavRefreshSuccess",
          );
        }
      } catch (error) {
        setWebdavStatus(signature, "failed");
        showNotice.error(
          "settings.modals.backup.messages.webdavRefreshFailed",
          { error },
        );
      } finally {
        handleLoading(false);
      }
    },
    [handleLoading, webdavSignature],
  );

  const refreshSilently = useCallback(
    (signature?: string) => refreshWebdav({ silent: true, signature }),
    [refreshWebdav],
  );

  return (
    <BaseDialog
      open={open}
      title={t("settings.modals.backup.webdav.title")}
      contentSx={{ width: { xs: 360, sm: 520 } }}
      disableOk
      cancelBtn={t("shared.actions.close")}
      onCancel={onClose}
      onClose={onClose}
    >
      <Box sx={{ position: "relative" }}>
        <BaseLoadingOverlay isLoading={loading} />
        <BackupConfigViewer
          setLoading={handleLoading}
          onBackupSuccess={async () => {
            await refreshSilently();
            onBackupSuccess?.();
          }}
          onSaveSuccess={refreshSilently}
          onRefresh={refreshWebdav}
          onInit={refreshSilently}
        />
      </Box>
    </BaseDialog>
  );
};
