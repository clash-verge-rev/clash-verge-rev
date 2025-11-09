import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import RestoreIcon from "@mui/icons-material/Restore";
import {
  Box,
  Divider,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
} from "@mui/material";
import { Typography } from "@mui/material";
import { save } from "@tauri-apps/plugin-dialog";
import { useLockFn } from "ahooks";
import type { Dayjs } from "dayjs";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { restartApp } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

export type BackupTableRow = {
  platform: string;
  backup_time: Dayjs;
  allow_apply: boolean;
  filename: string;
};

export const DEFAULT_ROWS_PER_PAGE = 5;

type ConfirmFn = (message?: string) => boolean | Promise<boolean>;

const confirmAsync = async (message: string): Promise<boolean> => {
  const confirmFn = window.confirm as unknown as ConfirmFn;
  return await confirmFn.call(window, message);
};

interface BackupHistoryTableProps {
  datasource: BackupTableRow[];
  page: number;
  total: number;
  onPageChange: (
    event: React.MouseEvent<HTMLButtonElement> | null,
    page: number,
  ) => void;
  onRefresh: () => Promise<void>;
  onDelete: (filename: string) => Promise<void>;
  onRestore: (filename: string) => Promise<void>;
  onExport?: (filename: string, destination: string) => Promise<void>;
}

export const BackupHistoryTable = memo(
  ({
    datasource,
    total,
    page,
    onPageChange,
    onRefresh,
    onDelete,
    onRestore,
    onExport,
  }: BackupHistoryTableProps) => {
    const { t } = useTranslation();

    const handleDelete = useLockFn(async (filename: string) => {
      const confirmed = await confirmAsync(
        t("settings.modals.backup.messages.confirmDelete"),
      );
      if (!confirmed) return;
      await onDelete(filename);
      await onRefresh();
    });

    const handleRestore = useLockFn(async (filename: string) => {
      const confirmed = await confirmAsync(
        t("settings.modals.backup.messages.confirmRestore"),
      );
      if (!confirmed) return;
      await onRestore(filename);
      showNotice.success("settings.modals.backup.messages.restoreSuccess");
      await restartApp();
    });

    const handleExport = useLockFn(async (filename: string) => {
      if (!onExport) return;
      try {
        const savePath = await save({ defaultPath: filename });
        if (!savePath || Array.isArray(savePath)) return;
        await onExport(filename, savePath);
        showNotice.success(
          "settings.modals.backup.messages.localBackupExported",
        );
      } catch (error) {
        console.error(error);
        showNotice.error(
          "settings.modals.backup.messages.localBackupExportFailed",
        );
      }
    });

    return (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>
                {t("settings.modals.backup.table.filename")}
              </TableCell>
              <TableCell>
                {t("settings.modals.backup.table.backupTime")}
              </TableCell>
              <TableCell align="right">
                {t("settings.modals.backup.table.actions")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {datasource.length > 0 ? (
              datasource.map((file) => {
                const rowKey = `${file.platform}-${file.filename}-${file.backup_time.valueOf()}`;
                return (
                  <TableRow key={rowKey} hover>
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          sx={{ flex: 1 }}
                        >
                          {file.filename}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {file.platform}
                      </Typography>
                    </TableCell>
                    <TableCell>{file.backup_time.fromNow()}</TableCell>
                    <TableCell align="right">
                      <Box
                        sx={{ display: "inline-flex", alignItems: "center" }}
                      >
                        {onExport && (
                          <>
                            <IconButton
                              color="primary"
                              aria-label={t(
                                "settings.modals.backup.actions.export",
                              )}
                              size="small"
                              onClick={() => handleExport(file.filename)}
                            >
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                            <Divider
                              orientation="vertical"
                              flexItem
                              sx={{ mx: 1, height: 20 }}
                            />
                          </>
                        )}
                        <IconButton
                          color="secondary"
                          aria-label={t("shared.actions.delete")}
                          size="small"
                          onClick={() => handleDelete(file.filename)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                        <Divider
                          orientation="vertical"
                          flexItem
                          sx={{ mx: 1, height: 20 }}
                        />
                        <IconButton
                          color="success"
                          aria-label={t(
                            "settings.modals.backup.actions.restore",
                          )}
                          size="small"
                          onClick={() => handleRestore(file.filename)}
                        >
                          <RestoreIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={3} align="center">
                  {t("settings.modals.backup.table.noBackups")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={onPageChange}
          rowsPerPage={DEFAULT_ROWS_PER_PAGE}
          rowsPerPageOptions={[DEFAULT_ROWS_PER_PAGE]}
        />
      </TableContainer>
    );
  },
);
