import {
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useTranslation } from "react-i18next";
import { BaseDialog, DialogRef } from "@/components/base";
import getSystem from "@/utils/get-system";
import { BaseLoadingOverlay } from "@/components/base";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import {
  BackupTableViewer,
  BackupFile,
  DEFAULT_ROWS_PER_PAGE,
} from "./backup-table-viewer";
import { BackupConfigViewer } from "./backup-config-viewer";
import { Box, Paper, Divider } from "@mui/material";
import { listWebDavBackup } from "@/services/cmds";
dayjs.extend(customParseFormat);

const DATE_FORMAT = "YYYY-MM-DD_HH-mm-ss";
const FILENAME_PATTERN = /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/;

export const BackupViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
  const [dataSource, setDataSource] = useState<BackupFile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const OS = getSystem();

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

  const fetchAndSetBackupFiles = async () => {
    try {
      setIsLoading(true);
      const files = await getAllBackupFiles();
      setBackupFiles(files);
      setTotal(files.length);
    } catch (error) {
      setBackupFiles([]);
      setTotal(0);
      console.error(error);
      // Notice.error(t("Failed to fetch backup files"));
    } finally {
      setIsLoading(false);
    }
  };

  const getAllBackupFiles = async () => {
    const files = await listWebDavBackup();
    return files
      .map((file) => {
        const platform = file.filename.split("-")[0];
        const fileBackupTimeStr = file.filename.match(FILENAME_PATTERN)!;

        if (fileBackupTimeStr === null) {
          return null;
        }

        const backupTime = dayjs(fileBackupTimeStr[0], DATE_FORMAT);
        const allowApply = OS === platform;
        return {
          ...file,
          platform,
          backup_time: backupTime,
          allow_apply: allowApply,
        } as BackupFile;
      })
      .filter((item) => item !== null)
      .sort((a, b) => (a.backup_time.isAfter(b.backup_time) ? -1 : 1));
  };

  useEffect(() => {
    setDataSource(
      backupFiles.slice(
        page * DEFAULT_ROWS_PER_PAGE,
        page * DEFAULT_ROWS_PER_PAGE + DEFAULT_ROWS_PER_PAGE,
      ),
    );
  }, [page, backupFiles]);

  return (
    <BaseDialog
      open={open}
      title={t("Backup Setting")}
      // contentSx={{ width: 600, maxHeight: 800 }}
      okBtn={t("")}
      cancelBtn={t("Close")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      disableOk
    >
      <Box>
        <BaseLoadingOverlay isLoading={isLoading} />
        <Paper elevation={2} sx={{ padding: 2 }}>
          <BackupConfigViewer
            setLoading={setIsLoading}
            onBackupSuccess={async () => {
              fetchAndSetBackupFiles();
            }}
            onSaveSuccess={async () => {
              fetchAndSetBackupFiles();
            }}
            onRefresh={async () => {
              fetchAndSetBackupFiles();
            }}
            onInit={async () => {
              fetchAndSetBackupFiles();
            }}
          />
          <Divider sx={{ marginY: 2 }} />
          <BackupTableViewer
            datasource={dataSource}
            page={page}
            onPageChange={handleChangePage}
            total={total}
            onRefresh={fetchAndSetBackupFiles}
          />
        </Paper>
      </Box>
    </BaseDialog>
  );
});
