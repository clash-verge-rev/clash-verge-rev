import DeleteOutline from "@mui/icons-material/DeleteOutline";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import RestoreRounded from "@mui/icons-material/RestoreRounded";
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { save } from "@tauri-apps/plugin-dialog";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, BaseLoadingOverlay } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import {
  deleteLocalBackup,
  deleteWebdavBackup,
  exportLocalBackup,
  listLocalBackup,
  listWebDavBackup,
  restartApp,
  restoreLocalBackup,
  restoreWebDavBackup,
} from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import {
  buildWebdavSignature,
  getWebdavStatus,
  setWebdavStatus,
} from "@/services/webdav-status";

dayjs.extend(customParseFormat);
dayjs.extend(relativeTime);

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

interface BackupRow {
  filename: string;
  platform: string;
  backup_time: dayjs.Dayjs | null;
  display_time: string;
  sort_value: number;
}

const confirmAsync = async (message: string) => {
  const fn = window.confirm as (msg?: string) => boolean;
  return fn(message);
};

export const BackupHistoryViewer = ({
  open,
  source,
  page,
  onSourceChange,
  onPageChange,
  onClose,
}: BackupHistoryViewerProps) => {
  const { t } = useTranslation();
  const { verge } = useVerge();
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const isLocal = source === "local";
  const isWebDavConfigured = Boolean(
    verge?.webdav_url && verge?.webdav_username && verge?.webdav_password,
  );
  const webdavSignature = buildWebdavSignature(verge);
  const webdavStatus = getWebdavStatus(webdavSignature);
  const shouldSkipWebDav = !isLocal && !isWebDavConfigured;
  const pageSize = 8;
  const isBusy = loading || isRestoring || isRestarting;

  const buildRow = useCallback(
    (item: ILocalBackupFile | IWebDavFile): BackupRow | null => {
      const { filename, last_modified } = item;
      if (!filename.toLowerCase().endsWith(".zip")) return null;

      const platform =
        (filename.includes("-") && filename.split("-")[0]) ||
        t("settings.modals.backup.history.unknownPlatform", {
          defaultValue: "unknown",
        });
      const match = filename.match(FILENAME_PATTERN);
      const parsedFromName = match ? dayjs(match[0], DATE_FORMAT, true) : null;
      const parsedFromModified =
        last_modified && dayjs(last_modified).isValid()
          ? dayjs(last_modified)
          : null;
      const backupTime = parsedFromName?.isValid()
        ? parsedFromName
        : parsedFromModified;

      return {
        filename,
        platform,
        backup_time: backupTime ?? null,
        display_time:
          backupTime?.format("YYYY-MM-DD HH:mm") ??
          parsedFromModified?.format("YYYY-MM-DD HH:mm") ??
          t("settings.modals.backup.history.unknownTime", {
            defaultValue: "Unknown time",
          }),
        sort_value:
          backupTime?.valueOf() ??
          parsedFromModified?.valueOf() ??
          Number.NEGATIVE_INFINITY,
      };
    },
    [t],
  );

  const fetchRows = useCallback(
    async (options?: { force?: boolean }) => {
      if (!open) return;
      if (shouldSkipWebDav) {
        setRows([]);
        return;
      }
      if (!isLocal && webdavStatus === "failed" && !options?.force) {
        setRows([]);
        return;
      }

      setLoading(true);
      try {
        const list = isLocal
          ? await listLocalBackup()
          : await listWebDavBackup();
        if (!isLocal) {
          setWebdavStatus(webdavSignature, "ready");
        }
        setRows(
          list
            .map((item) => buildRow(item))
            .filter((item): item is BackupRow => item !== null)
            .sort((a, b) =>
              a.sort_value === b.sort_value
                ? b.filename.localeCompare(a.filename)
                : b.sort_value - a.sort_value,
            ),
        );
      } catch (error) {
        if (!isLocal) {
          setWebdavStatus(webdavSignature, "failed");
        }
        console.error(error);
        setRows([]);
        showNotice.error(error);
      } finally {
        setLoading(false);
      }
    },
    [buildRow, isLocal, open, shouldSkipWebDav, webdavSignature, webdavStatus],
  );

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedRows = rows.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );

  const summary = useMemo(() => {
    if (shouldSkipWebDav || (!isLocal && webdavStatus === "failed")) {
      return t("settings.modals.backup.manual.webdav");
    }
    if (!total) return t("settings.modals.backup.history.empty");
    const recent =
      rows[0]?.backup_time?.fromNow() ?? rows[0]?.display_time ?? "";
    return t("settings.modals.backup.history.summary", {
      count: total,
      recent,
    });
  }, [isLocal, rows, shouldSkipWebDav, t, total, webdavStatus]);

  const handleDelete = useLockFn(async (filename: string) => {
    if (isRestarting) return;
    if (
      !(await confirmAsync(t("settings.modals.backup.messages.confirmDelete")))
    )
      return;
    if (isLocal) {
      await deleteLocalBackup(filename);
    } else {
      await deleteWebdavBackup(filename);
    }
    await fetchRows();
  });

  const handleRestore = useLockFn(async (filename: string) => {
    if (isRestoring || isRestarting) return;
    if (
      !(await confirmAsync(t("settings.modals.backup.messages.confirmRestore")))
    )
      return;
    setIsRestoring(true);
    try {
      if (isLocal) {
        await restoreLocalBackup(filename);
      } else {
        await restoreWebDavBackup(filename);
      }
      showNotice.success("settings.modals.backup.messages.restoreSuccess");
      setIsRestarting(true);
      window.setTimeout(() => {
        void restartApp().catch((err: unknown) => {
          setIsRestarting(false);
          showNotice.error(err);
        });
      }, 1000);
    } catch (error) {
      console.error(error);
      showNotice.error(error);
    } finally {
      setIsRestoring(false);
    }
  });

  const handleExport = useLockFn(async (filename: string) => {
    if (isRestarting) return;
    if (!isLocal) return;
    const savePath = await save({ defaultPath: filename });
    if (!savePath || Array.isArray(savePath)) return;
    try {
      await exportLocalBackup(filename, savePath);
      showNotice.success("settings.modals.backup.messages.localBackupExported");
    } catch (ignoreError: unknown) {
      showNotice.error(
        "settings.modals.backup.messages.localBackupExportFailed",
      );
    }
  });

  const handleRefresh = () => {
    if (isRestarting) return;
    void fetchRows({ force: true });
  };

  return (
    <BaseDialog
      open={open}
      title={t("settings.modals.backup.history.title")}
      contentSx={{ width: 520 }}
      disableOk
      cancelBtn={t("shared.actions.close")}
      onCancel={onClose}
      onClose={onClose}
    >
      <Box sx={{ position: "relative", minHeight: 320 }}>
        <BaseLoadingOverlay isLoading={isBusy} />
        <Stack spacing={2}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Tabs
              value={source}
              onChange={(_, val) => {
                if (isBusy) return;
                onSourceChange(val as BackupSource);
                onPageChange(0);
              }}
              textColor="primary"
              indicatorColor="primary"
            >
              <Tab
                value="local"
                label={t("settings.modals.backup.tabs.local")}
                disabled={isBusy}
                sx={{ px: 2 }}
              />
              <Tab
                value="webdav"
                label={t("settings.modals.backup.tabs.webdav")}
                disabled={isBusy}
                sx={{ px: 2 }}
              />
            </Tabs>
            <IconButton size="small" onClick={handleRefresh} disabled={isBusy}>
              <RefreshRounded fontSize="small" />
            </IconButton>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {summary}
          </Typography>

          <List
            disablePadding
            subheader={
              <ListSubheader disableSticky>
                {t("settings.modals.backup.history.title")}
              </ListSubheader>
            }
          >
            {pagedRows.length === 0 ? (
              <ListItem>
                <ListItemText
                  primary={t("settings.modals.backup.history.empty") || ""}
                />
              </ListItem>
            ) : (
              pagedRows.map((row) => (
                <ListItem key={`${row.platform}-${row.filename}`} divider>
                  <ListItemText
                    primary={
                      <Typography
                        variant="body2"
                        sx={{ wordBreak: "break-all", fontWeight: 500 }}
                      >
                        {row.filename}
                      </Typography>
                    }
                    secondary={
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        spacing={1.5}
                      >
                        <Typography variant="caption" color="text.secondary">
                          {`${row.platform} · ${row.display_time}`}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={0.5}
                          alignItems="center"
                        >
                          {isLocal && (
                            <IconButton
                              size="small"
                              disabled={isBusy}
                              onClick={() => handleExport(row.filename)}
                            >
                              <DownloadRounded fontSize="small" />
                            </IconButton>
                          )}
                          <IconButton
                            size="small"
                            disabled={isBusy}
                            onClick={() => handleDelete(row.filename)}
                          >
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            disabled={isBusy}
                            onClick={() => handleRestore(row.filename)}
                          >
                            <RestoreRounded fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Stack>
                    }
                  />
                </ListItem>
              ))
            )}
          </List>

          {pageCount > 1 && (
            <Stack
              direction="row"
              spacing={1}
              justifyContent="flex-end"
              alignItems="center"
            >
              <Typography variant="caption">
                {currentPage + 1} / {pageCount}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="text"
                  disabled={isBusy || currentPage === 0}
                  onClick={() => onPageChange(Math.max(0, currentPage - 1))}
                >
                  {t("shared.actions.previous")}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={isBusy || currentPage >= pageCount - 1}
                  onClick={() =>
                    onPageChange(Math.min(pageCount - 1, currentPage + 1))
                  }
                >
                  {t("shared.actions.next")}
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </Box>
    </BaseDialog>
  );
};
