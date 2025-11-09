import { Box } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, BaseLoadingOverlay } from "@/components/base";

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
  const [loading, setLoading] = useState(false);

  const handleLoading = (value: boolean) => {
    setLoading(value);
    setBusy?.(value);
  };

  const noop = async () => {};

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
            await noop();
            onBackupSuccess?.();
          }}
          onSaveSuccess={noop}
          onRefresh={noop}
          onInit={noop}
        />
      </Box>
    </BaseDialog>
  );
};
