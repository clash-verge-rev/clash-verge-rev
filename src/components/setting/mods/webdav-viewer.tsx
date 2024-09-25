import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import {
  createAndUploadBackup,
  deleteBackup,
  downloadBackupAndReload,
  listBackup,
  restartApp,
  updateWebDavInfo,
} from "@/services/cmds";
import { sleep } from "@/utils";
import {
  Backup,
  Check,
  Delete,
  InboxRounded,
  Save,
  Visibility,
  VisibilityOff,
} from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import {
  Box,
  Checkbox,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

const TypeDiv = styled("div")(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "fit-content",
  padding: "2px 5px",
  borderRadius: 4,
  backgroundColor: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
}));

export const WebDavViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { verge, patchVerge } = useVerge();
  const {
    webdav_url = "",
    webdav_username = "",
    webdav_password = "",
  } = verge || {};
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [deletingFile, setDeletingFile] = useState("");
  const [applyingFile, setApplyingFile] = useState("");
  const [onlyBackupProfiles, setOnlyBackupProfiles] = useState(false);
  const [backupFiles, setBackupFiles] = useState<IWebDavListFile[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState, reset } = useForm<IWebDavConfig>({
    defaultValues: {
      url: webdav_url,
      username: webdav_username,
      password: webdav_password,
    },
  });
  const onSubmit = async (data: IWebDavConfig) => {
    setBackupFiles([]);
    try {
      await patchVerge({
        webdav_url: data.url,
        webdav_username: data.username,
        webdav_password: data.password,
      });
      await updateWebDavInfo(data.url, data.username, data.password);
      await getAllBackupFiles();
      Notice.success("WebDAV info updated successfully");
    } catch (e) {
      Notice.error(`Failed to connect to WebDAV server, error: ${e}`);
    }
  };

  useImperativeHandle(ref, () => ({
    open: () => {
      reset({
        url: webdav_url,
        username: webdav_username,
        password: webdav_password,
      });
      setOpen(true);
    },
    close: () => {
      reset({
        url: webdav_url,
        username: webdav_username,
        password: webdav_password,
      });
      setOpen(false);
    },
  }));

  useEffect(() => {
    getAllBackupFiles();
  }, []);

  const getAllBackupFiles = async () => {
    const files = await listBackup();
    files.sort((a, b) => {
      const aDate = dayjs(a.last_modified);
      const bDate = dayjs(b.last_modified);
      return aDate.isAfter(bDate) ? -1 : 1;
    });
    setBackupFiles(files);
  };

  const handleDeleteBackup = async (file: IWebDavListFile) => {
    try {
      setDeletingFile(file.filename);
      await deleteBackup(file.filename);
      await getAllBackupFiles();
      Notice.success(`Backup ${file.filename} deleted successfully`);
    } catch (e) {
      Notice.error(`Failed to delete backup, error: ${e}`);
    } finally {
      setDeletingFile("");
    }
  };

  const handleApplyBackup = useLockFn(async (file: IWebDavListFile) => {
    try {
      setApplyingFile(file.filename);
      await downloadBackupAndReload(file.filename);
      await sleep(1000);
      Notice.success(
        `Backup ${file.filename} applied successfully, will restart app soon`,
      );
      setApplyingFile("");
      await sleep(1000);
      restartApp();

      // TODO: follow code need to handle websocket error bug when controller port or secret changed, so comment it

      // const verge = await getVergeConfig();
      // const mode = verge.theme_mode;
      // if (mode) {
      //   if (mode === "system") {
      //     const theme = (await appWindow.theme()) ?? "light";
      //     setMode(theme);
      //   } else {
      //     setMode(mode);
      //   }
      // }
      // emit reload all event
      // emit("verge://reload-all");
    } catch (e) {
      Notice.error(`Failed to apply backup, error: ${e}`);
      setApplyingFile("");
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("WebDav Backup")}
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  checked={onlyBackupProfiles}
                  onChange={(e) => setOnlyBackupProfiles(e.target.checked)}
                />
              }
              label={t("Only Backup Profiles")}
            />
            <LoadingButton
              variant="contained"
              size="small"
              loading={isBackingUp}
              onClick={async () => {
                try {
                  setIsBackingUp(true);
                  await createAndUploadBackup(false, onlyBackupProfiles);
                  await getAllBackupFiles();
                  Notice.success(t("Backup successfully"));
                } catch (e) {
                  Notice.error(`Failed to backup, error: ${e}`);
                } finally {
                  setIsBackingUp(false);
                }
              }}
              loadingPosition="start"
              startIcon={<Backup />}>
              {t("Backup")}
            </LoadingButton>
          </Box>
        </Box>
      }
      disableOk
      cancelBtn={t("Back")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}>
      <Box>
        <Box sx={{ padding: 1 }}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <TextField
              sx={{ marginBottom: 2 }}
              fullWidth
              label={t("WebDav URL")}
              {...register("url")}
            />
            <TextField
              sx={{ marginBottom: 2 }}
              fullWidth
              label={t("WebDav Username")}
              {...register("username")}
            />
            <TextField
              type={showPassword ? "text" : "password"}
              sx={{ marginBottom: 2 }}
              fullWidth
              label={t("WebDav Password")}
              {...register("password")}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment sx={{ mr: 1 }} position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={() => setShowPassword((pre) => !pre)}
                        edge="end">
                        {showPassword ? (
                          <VisibilityOff color="primary" fontSize="small" />
                        ) : (
                          <Visibility color="primary" fontSize="small" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <LoadingButton
              type="submit"
              variant="contained"
              fullWidth
              loading={formState.isSubmitting}
              loadingPosition="start"
              startIcon={<Save />}
              disabled={!formState.isValid}>
              {t("Save")}
            </LoadingButton>
          </form>
        </Box>
        <Divider variant="middle" flexItem sx={{ mt: 1 }}>
          {t("Backup Files")}
        </Divider>
        <Box>
          {backupFiles.length > 0 ? (
            <List>
              {backupFiles.map((file) => (
                <ListItem
                  sx={{
                    backgroundColor: "var(--background-color-alpha)",
                    mb: 1,
                    borderRadius: "6px",
                  }}
                  key={file.href}>
                  <ListItemText
                    sx={{ wordBreak: "break-all", mr: 1 }}
                    primary={file.filename}
                    secondary={
                      file.filename.includes("profiles") ? (
                        <TypeDiv>Profiles</TypeDiv>
                      ) : (
                        <TypeDiv>Config + Profiles</TypeDiv>
                      )
                    }
                  />
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
                  <LoadingButton
                    sx={{ minWidth: "80px" }}
                    disabled={deletingFile === file.filename}
                    loading={applyingFile === file.filename}
                    onClick={() => handleApplyBackup(file)}
                    variant="contained"
                    size="small"
                    loadingPosition="start"
                    startIcon={<Check />}>
                    {t("Apply")}
                  </LoadingButton>
                </ListItem>
              ))}
            </List>
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
      </Box>
    </BaseDialog>
  );
});
