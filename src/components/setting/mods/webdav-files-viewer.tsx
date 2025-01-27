import LinuxIcon from "@/assets/image/linux.svg?react";
import MacIcon from "@/assets/image/macos.svg?react";
import WindowsIcon from "@/assets/image/windows.svg?react";
import {
  BaseDialog,
  DialogRef,
  Notice,
  ScrollableText,
} from "@/components/base";
import { useProfiles } from "@/hooks/use-profiles";
import {
  deleteBackup,
  downloadBackupAndReload,
  getVergeConfig,
  listBackup,
  restartApp,
} from "@/services/cmds";
import { useSetThemeMode } from "@/services/states";
import { sleep } from "@/utils";
import getSystem from "@/utils/get-system";
import { Check, Delete, InboxRounded } from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import {
  Box,
  Chip,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useLockFn } from "ahooks";
import dayjs, { Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

dayjs.extend(customParseFormat);
const OS = getSystem();

type BackupFile = IWebDavFile & {
  platform: string;
  type: "profiles" | "all";
  backupTime: Dayjs;
  allowApply: boolean;
};

export interface WebDavFilesViewerRef extends DialogRef {
  getAllBackupFiles: () => Promise<void>;
}

export const WebDavFilesViewer = forwardRef<WebDavFilesViewerRef>(
  (props, ref) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const setMode = useSetThemeMode();
    const { activateSelected } = useProfiles();

    const [deletingFile, setDeletingFile] = useState("");
    const [applyingFile, setApplyingFile] = useState("");
    const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
    const [filter, setFilter] = useState<"all" | "profiles">("all");
    const filterBackupFiles = backupFiles.filter(
      (item) => item.type === filter,
    );

    useImperativeHandle(ref, () => ({
      open: () => {
        setOpen(true);
      },
      close: () => {
        setOpen(false);
      },
      getAllBackupFiles: () => getAllBackupFiles(),
    }));

    const getAllBackupFiles = async () => {
      const files = await listBackup();
      const backupFiles = files
        .map((file) => {
          const platform = file.filename.split("-")[0];
          const type =
            file.filename.split("-")[1] === "profiles" ? "profiles" : "all";
          const fileBackupTimeStr = file.filename.match(
            /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
          )!;
          const backupTime = dayjs(fileBackupTimeStr[0], "YYYY-MM-DD_HH-mm-ss");
          const allowApply =
            (type === "all" && OS === platform) || type === "profiles";
          return {
            ...file,
            platform,
            type,
            backupTime,
            allowApply,
          } as BackupFile;
        })
        .sort((a, b) => (a.backupTime.isAfter(b.backupTime) ? -1 : 1));
      setBackupFiles(backupFiles);
    };

    const handleDeleteBackup = async (file: BackupFile) => {
      try {
        setDeletingFile(file.filename);
        await deleteBackup(file.filename);
        await getAllBackupFiles();
        Notice.success(t("Delete Backup Successful"));
      } catch (e) {
        Notice.error(t("Delete Backup Failed", { error: e }));
      } finally {
        setDeletingFile("");
      }
    };

    const handleApplyBackup = useLockFn(async (file: BackupFile) => {
      try {
        setApplyingFile(file.filename);
        await downloadBackupAndReload(file.filename);
        await sleep(1000);
        setApplyingFile("");
        // apply theme mode
        const verge = await getVergeConfig();
        const mode = verge.theme_mode;
        if (mode) {
          if (mode === "system") {
            const appWindow = getCurrentWebviewWindow();
            const theme = (await appWindow.theme()) ?? "light";
            setMode(theme);
          } else {
            setMode(mode);
          }
        }
        Notice.success(t("Apply Backup Successful"));

        // emit reload all event
        // emit("verge://reload-all");
        await sleep(1000);
        await activateSelected();
        await sleep(1000);
        restartApp();
      } catch (e) {
        Notice.error(t("Apply Backup Failed"));
        setApplyingFile("");
      }
    });

    return (
      <BaseDialog
        open={open}
        fullWidth
        contentStyle={{ width: 600 }}
        title={
          <div className="flex items-center justify-between">
            {t("Backup Files")}
            <div>
              <FormControl>
                <RadioGroup
                  row
                  aria-labelledby="demo-radio-buttons-group-label"
                  value={filter}
                  name="radio-buttons-group"
                  onChange={(e) => {
                    let value = (e.target as HTMLInputElement).value;
                    if (value === "profiles") {
                      setFilter("profiles");
                    } else if (value === "all") {
                      setFilter("all");
                    }
                  }}>
                  <FormControlLabel
                    value="all"
                    control={<Radio />}
                    label={t("BK_All")}
                  />
                  <FormControlLabel
                    value="profiles"
                    control={<Radio />}
                    label={t("BK_Profiles")}
                  />
                </RadioGroup>
              </FormControl>
            </div>
          </div>
        }
        hideOkBtn
        cancelBtn={t("Back")}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}>
        <Box>
          {filterBackupFiles.length > 0 ? (
            <div>
              {filterBackupFiles.map((file) => (
                <div
                  className="my-2 flex items-center justify-between rounded-md bg-primary-alpha px-2 py-1"
                  key={file.href}>
                  <div className="mr-2 flex-shrink-0 flex-grow-0 basis-10 p-1">
                    {file.platform === "windows" ? (
                      <WindowsIcon className="h-full w-full" />
                    ) : file.platform === "linux" ? (
                      <LinuxIcon className="h-full w-full" />
                    ) : (
                      <MacIcon className="h-full w-full" />
                    )}
                  </div>
                  <div className="mr-2 flex flex-grow flex-col justify-center space-y-2 overflow-hidden py-1">
                    <ScrollableText>{file.filename}</ScrollableText>
                    <div>
                      <Chip
                        size="small"
                        variant="outlined"
                        color="primary"
                        label={
                          file.type === "profiles"
                            ? t("BK_Profiles")
                            : t("BK_All")
                        }
                      />
                      <span className="ml-4 text-xs text-gray-500 dark:text-gray-400">
                        {file.backupTime.fromNow()}
                      </span>
                    </div>
                  </div>
                  <LoadingButton
                    sx={{ mr: 1, minWidth: "80px" }}
                    disabled={applyingFile === file.filename}
                    loading={deletingFile === file.filename}
                    onClick={() => handleDeleteBackup(file)}
                    variant="contained"
                    color="error"
                    size="small"
                    loadingPosition="start"
                    startIcon={<Delete />}>
                    {t("Delete")}
                  </LoadingButton>
                  <Tooltip
                    title={!file.allowApply ? t("Platform No Match") : null}>
                    <div>
                      <LoadingButton
                        sx={{ minWidth: "80px" }}
                        disabled={
                          !file.allowApply || deletingFile === file.filename
                        }
                        loading={applyingFile === file.filename}
                        onClick={() => handleApplyBackup(file)}
                        variant="contained"
                        size="small"
                        loadingPosition="start"
                        startIcon={<Check />}>
                        {t("Apply")}
                      </LoadingButton>
                    </div>
                  </Tooltip>
                </div>
              ))}
            </div>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                height: "100px",
              }}>
              <InboxRounded sx={{ fontSize: "4em" }} />
              <Typography sx={{ fontSize: "1.25em" }}>Empty</Typography>
            </Box>
          )}
        </Box>
      </BaseDialog>
    );
  },
);
