import { Box, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, BaseLoadingOverlay } from "@/components/base";
import {
  deleteLocalBackup,
  deleteWebdavBackup,
  exportLocalBackup,
  listLocalBackup,
  listWebDavBackup,
  restoreLocalBackup,
  restoreWebDavBackup,
} from "@/services/cmds";

import {
  BackupHistoryTable,
  DEFAULT_ROWS_PER_PAGE,
  type BackupTableRow,
} from "./backup-history-table";

dayjs.extend(customParseFormat);

const DATE_FORMAT = "YYYY-MM-DD_HH-mm-ss";
const FILENAME_PATTERN = /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/;

type BackupSource = "local" | "webdav";

interface BackupHistoryViewerProps {
  open: boolean;
  source: BackupSource;
  page: number;
  onSourceChange: (source: BackupSource) => void;
  onPageChange: (page: number) => void;
  onClose: () => void;
}

export const BackupHistoryViewer = ({
  open,
  source,
  page,
  onSourceChange,
  onPageChange,
  onClose,
}: BackupHistoryViewerProps) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<BackupTableRow[]>([]);
  const [loading, setLoading] = useState(false);

  const isLocal = source === "local";

  const buildBackupRow = useCallback(
    (filename: string): BackupTableRow | null => {
      const platform = filename.split("-")[0];
      const match = filename.match(FILENAME_PATTERN);
      if (!match) return null;
      return {
        filename,
        platform,
        backup_time: dayjs(match[0], DATE_FORMAT),
        allow_apply: true,
      };
    },
    [],
  );

  const fetchRows = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const list = isLocal ? await listLocalBackup() : await listWebDavBackup();
      setRows(
        list
          .map((file) => buildBackupRow(file.filename))
          .filter((item): item is BackupTableRow => item !== null)
          .sort((a, b) => (a.backup_time.isAfter(b.backup_time) ? -1 : 1)),
      );
    } finally {
      setLoading(false);
    }
  }, [isLocal, open, buildBackupRow]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const total = rows.length;
  const pagedData = useMemo(
    () =>
      rows.slice(
        page * DEFAULT_ROWS_PER_PAGE,
        page * DEFAULT_ROWS_PER_PAGE + DEFAULT_ROWS_PER_PAGE,
      ),
    [rows, page],
  );

  const summary = useMemo(() => {
    if (!total) {
      return t("settings.modals.backup.history.empty");
    }
    const recent = rows[0]?.backup_time.fromNow();
    return t("settings.modals.backup.history.summary", {
      count: total,
      recent,
    });
  }, [rows, total, t]);

  return (
    <BaseDialog
      open={open}
      title={t("settings.modals.backup.history.title")}
      contentSx={{ width: 720 }}
      disableOk
      cancelBtn={t("shared.actions.close")}
      onCancel={onClose}
      onClose={onClose}
    >
      <Box sx={{ position: "relative", minHeight: 360 }}>
        <BaseLoadingOverlay isLoading={loading} />
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Tabs
                value={source}
                onChange={(_, val) => {
                  onSourceChange(val as BackupSource);
                  onPageChange(0);
                }}
              >
                <Tab
                  value="local"
                  label={t("settings.modals.backup.tabs.local")}
                />
                <Tab
                  value="webdav"
                  label={t("settings.modals.backup.tabs.webdav")}
                />
              </Tabs>
              <Typography variant="body2" color="text.secondary">
                {summary}
              </Typography>
            </Stack>
          </Paper>
          <BackupHistoryTable
            datasource={pagedData}
            page={page}
            total={total}
            onPageChange={(_, newPage) => onPageChange(newPage)}
            onRefresh={fetchRows}
            onDelete={isLocal ? deleteLocalBackup : deleteWebdavBackup}
            onRestore={isLocal ? restoreLocalBackup : restoreWebDavBackup}
            onExport={isLocal ? exportLocalBackup : undefined}
          />
        </Stack>
      </Box>
    </BaseDialog>
  );
};
