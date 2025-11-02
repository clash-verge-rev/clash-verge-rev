import { Box, Button, Divider, Paper, Tab, Tabs } from "@mui/material";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import type { Ref } from "react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { BaseDialog, BaseLoadingOverlay, DialogRef } from "@/components/base";
import {
  deleteLocalBackup,
  deleteWebdavBackup,
  listLocalBackup,
  listWebDavBackup,
  exportLocalBackup,
  restoreLocalBackup,
  restoreWebDavBackup,
} from "@/services/cmds";

import { BackupConfigViewer } from "./backup-config-viewer";
import {
  BackupFile,
  BackupTableViewer,
  DEFAULT_ROWS_PER_PAGE,
} from "./backup-table-viewer";
import { LocalBackupActions } from "./local-backup-actions";
dayjs.extend(customParseFormat);

const DATE_FORMAT = "YYYY-MM-DD_HH-mm-ss";
const FILENAME_PATTERN = /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/;
type BackupSource = "local" | "webdav";
type CloseButtonPosition = { top: number; left: number } | null;

export function BackupViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [dialogPaper, setDialogPaper] = useReducer(
    (_: HTMLElement | null, next: HTMLElement | null) => next,
    null as HTMLElement | null,
  );
  const [closeButtonPosition, setCloseButtonPosition] = useReducer(
    (_: CloseButtonPosition, next: CloseButtonPosition) => next,
    null as CloseButtonPosition,
  );

  const [isLoading, setIsLoading] = useState(false);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [source, setSource] = useState<BackupSource>("local");

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  // Handle page change
  const handleChangePage = useCallback(
    (_: React.MouseEvent<HTMLButtonElement> | null, page: number) => {
      setPage(page);
    },
    [],
  );

  const handleChangeSource = useCallback(
    (_event: React.SyntheticEvent, newSource: string) => {
      setSource(newSource as BackupSource);
      setPage(0);
    },
    [],
  );

  const buildBackupFile = useCallback((filename: string) => {
    const platform = filename.split("-")[0];
    const fileBackupTimeStr = filename.match(FILENAME_PATTERN);

    if (fileBackupTimeStr === null) {
      return null;
    }

    const backupTime = dayjs(fileBackupTimeStr[0], DATE_FORMAT);
    const allowApply = true;
    return {
      filename,
      platform,
      backup_time: backupTime,
      allow_apply: allowApply,
    } as BackupFile;
  }, []);

  const getAllBackupFiles = useCallback(async (): Promise<BackupFile[]> => {
    if (source === "local") {
      const files = await listLocalBackup();
      return files
        .map((file) => buildBackupFile(file.filename))
        .filter((item): item is BackupFile => item !== null)
        .sort((a, b) => (a.backup_time.isAfter(b.backup_time) ? -1 : 1));
    }

    const files = await listWebDavBackup();
    return files
      .map((file) => {
        return buildBackupFile(file.filename);
      })
      .filter((item): item is BackupFile => item !== null)
      .sort((a, b) => (a.backup_time.isAfter(b.backup_time) ? -1 : 1));
  }, [buildBackupFile, source]);

  const fetchAndSetBackupFiles = useCallback(async () => {
    try {
      setIsLoading(true);
      const files = await getAllBackupFiles();
      setBackupFiles(files);
      setTotal(files.length);
    } catch (error) {
      setBackupFiles([]);
      setTotal(0);
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [getAllBackupFiles]);

  useEffect(() => {
    if (open) {
      fetchAndSetBackupFiles();
      const paper = contentRef.current?.closest(".MuiPaper-root");
      setDialogPaper((paper as HTMLElement) ?? null);
    } else {
      setDialogPaper(null);
    }
  }, [open, fetchAndSetBackupFiles]);

  useEffect(() => {
    if (!open || dialogPaper) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const paper = contentRef.current?.closest(".MuiPaper-root");
      setDialogPaper((paper as HTMLElement) ?? null);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, dialogPaper]);

  useEffect(() => {
    if (!dialogPaper) {
      setCloseButtonPosition(null);
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const updatePosition = () => {
      const rect = dialogPaper.getBoundingClientRect();
      setCloseButtonPosition({
        top: rect.bottom - 16,
        left: rect.right - 24,
      });
    };

    updatePosition();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updatePosition();
      });
      resizeObserver.observe(dialogPaper);
    }

    const scrollTargets: EventTarget[] = [];
    const addScrollListener = (target: EventTarget | null) => {
      if (!target) {
        return;
      }
      target.addEventListener("scroll", updatePosition, true);
      scrollTargets.push(target);
    };

    addScrollListener(window);
    addScrollListener(dialogPaper);
    const dialogContent = dialogPaper.querySelector(".MuiDialogContent-root");
    addScrollListener(dialogContent);

    window.addEventListener("resize", updatePosition);

    return () => {
      resizeObserver?.disconnect();
      scrollTargets.forEach((target) => {
        target.removeEventListener("scroll", updatePosition, true);
      });
      window.removeEventListener("resize", updatePosition);
    };
  }, [dialogPaper]);

  const handleDelete = useCallback(
    async (filename: string) => {
      if (source === "local") {
        await deleteLocalBackup(filename);
      } else {
        await deleteWebdavBackup(filename);
      }
    },
    [source],
  );

  const handleRestore = useCallback(
    async (filename: string) => {
      if (source === "local") {
        await restoreLocalBackup(filename);
      } else {
        await restoreWebDavBackup(filename);
      }
    },
    [source],
  );

  const handleExport = useCallback(
    async (filename: string, destination: string) => {
      await exportLocalBackup(filename, destination);
    },
    [],
  );

  const dataSource = useMemo<BackupFile[]>(
    () =>
      backupFiles.slice(
        page * DEFAULT_ROWS_PER_PAGE,
        page * DEFAULT_ROWS_PER_PAGE + DEFAULT_ROWS_PER_PAGE,
      ),
    [backupFiles, page],
  );

  return (
    <BaseDialog
      open={open}
      title={t("settings.backup.title")}
      contentSx={{
        minWidth: { xs: 320, sm: 620 },
        maxWidth: "unset",
        minHeight: 460,
      }}
      onClose={() => setOpen(false)}
      disableFooter
    >
      <Box
        ref={contentRef}
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        <BaseLoadingOverlay isLoading={isLoading} />
        <Paper
          elevation={2}
          sx={{
            padding: 2,
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          <Tabs
            value={source}
            onChange={handleChangeSource}
            aria-label={t("settings.backup.actions.selectTarget")}
            sx={{ mb: 2 }}
          >
            <Tab value="local" label={t("settings.backup.tabs.local")} />
            <Tab value="webdav" label={t("settings.backup.tabs.webdav")} />
          </Tabs>
          {source === "local" ? (
            <LocalBackupActions
              setLoading={setIsLoading}
              onBackupSuccess={fetchAndSetBackupFiles}
              onRefresh={fetchAndSetBackupFiles}
            />
          ) : (
            <BackupConfigViewer
              setLoading={setIsLoading}
              onBackupSuccess={fetchAndSetBackupFiles}
              onSaveSuccess={fetchAndSetBackupFiles}
              onRefresh={fetchAndSetBackupFiles}
              onInit={fetchAndSetBackupFiles}
            />
          )}
          <Divider sx={{ marginY: 2 }} />
          <Box
            sx={{
              flexGrow: 1,
              overflow: "auto",
              minHeight: 0,
            }}
          >
            <BackupTableViewer
              datasource={dataSource}
              page={page}
              onPageChange={handleChangePage}
              total={total}
              onRefresh={fetchAndSetBackupFiles}
              onDelete={handleDelete}
              onRestore={handleRestore}
              onExport={source === "local" ? handleExport : undefined}
            />
          </Box>
        </Paper>
      </Box>
      {dialogPaper &&
        closeButtonPosition &&
        createPortal(
          <Box
            sx={{
              position: "fixed",
              top: closeButtonPosition.top,
              left: closeButtonPosition.left,
              transform: "translate(-100%, -100%)",
              pointerEvents: "none",
              zIndex: (theme) => theme.zIndex.modal + 1,
            }}
          >
            <Button
              variant="outlined"
              onClick={() => setOpen(false)}
              sx={{
                pointerEvents: "auto",
                boxShadow: (theme) => theme.shadows[3],
                backgroundColor: (theme) => theme.palette.background.paper,
              }}
            >
              {t("common.actions.close")}
            </Button>
          </Box>,
          dialogPaper,
        )}
    </BaseDialog>
  );
}
