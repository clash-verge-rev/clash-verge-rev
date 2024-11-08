import { forwardRef, useImperativeHandle, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { Typography } from "@mui/material";
import { useForm } from "react-hook-form";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { isValidUrl } from "@/utils/helper";
import { BaseLoadingOverlay } from "@/components/base";
import {
  TextField,
  Button,
  Grid,
  Box,
  Paper,
  Stack,
  IconButton,
  InputAdornment,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import DeleteIcon from "@mui/icons-material/Delete";
import RestoreIcon from "@mui/icons-material/Restore";
import { createWebdavBackup, saveWebdavConfig } from "@/services/cmds";
import { save } from "@tauri-apps/plugin-dialog";

export const BackupViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { verge, mutateVerge } = useVerge();
  const { webdav_url, webdav_username, webdav_password } = verge || {};
  const [showPassword, setShowPassword] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, watch } = useForm<IWebDavConfig>({
    defaultValues: {
      url: webdav_url,
      username: webdav_username,
      password: webdav_password,
    },
  });

  const url = watch("url");
  const username = watch("username");
  const password = watch("password");
  const webdavChanged =
    webdav_url !== url ||
    webdav_username !== username ||
    webdav_password !== password;

  // const backups = [] as any[];
  const backups = [
    { name: "backup1.zip" },
    { name: "backup2.zip" },
    { name: "backup3.zip" },
  ];
  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  const checkForm = () => {
    const username = usernameRef.current?.value;
    const password = passwordRef.current?.value;
    const url = urlRef.current?.value;

    if (!url) {
      Notice.error(t("Webdav url cannot be empty"));
      urlRef.current?.focus();
      return;
    } else if (!isValidUrl(url)) {
      Notice.error(t("Webdav address must be url"));
      urlRef.current?.focus();
      return;
    }
    if (!username) {
      Notice.error(t("Username cannot be empty"));
      usernameRef.current?.focus();
      return;
    }
    if (!password) {
      Notice.error(t("Password cannot be empty"));
      passwordRef.current?.focus();
      return;
    }
  };

  const submit = async (data: IWebDavConfig) => {
    checkForm();
    setIsLoading(true);
    await saveWebdavConfig(data.url, data.username, data.password)
      .then(() => {
        mutateVerge(
          {
            webdav_url: data.url,
            webdav_username: data.username,
            webdav_password: data.password,
          },
          false
        );
        Notice.success(t("Webdav Config Saved Successfully"), 1500);
      })
      .catch((e) => {
        Notice.error(t("Webdav Config Save Failed", { error: e }), 3000);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const handleClickShowPassword = () => {
    setShowPassword(!showPassword);
  };

  const handleBackup = useLockFn(async () => {
    checkForm();
    setIsLoading(true);
    await createWebdavBackup()
      .then(() => {
        Notice.success(t("Backup Successfully"), 1500);
      })
      .finally(() => {
        setIsLoading(false);
      })
      .catch((e) => {
        console.log(e, "backup failed");
        Notice.error(t("Backup Failed", { error: e }), 3000);
      });
  });
  return (
    <BaseDialog
      open={open}
      title={t("Backup Setting")}
      contentSx={{ width: 600, maxHeight: 800 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      disableFooter={true}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <Box sx={{ maxWidth: 800 }}>
        <BaseLoadingOverlay isLoading={isLoading} />
        <Paper elevation={2} sx={{ padding: 2 }}>
          <form onSubmit={handleSubmit(submit)}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={9}>
                <Grid container spacing={2}>
                  {/* WebDAV Server Address */}
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      label="WebDAV Server URL"
                      variant="outlined"
                      size="small"
                      {...register("url")}
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      inputRef={urlRef}
                    />
                  </Grid>

                  {/* Username and Password */}
                  <Grid item xs={6}>
                    <TextField
                      label="Username"
                      variant="outlined"
                      size="small"
                      {...register("username")}
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      inputRef={usernameRef}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      label="Password"
                      type={showPassword ? "text" : "password"}
                      variant="outlined"
                      size="small"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                      inputRef={passwordRef}
                      {...register("password")}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={handleClickShowPassword}
                              edge="end"
                            >
                              {showPassword ? (
                                <VisibilityOff />
                              ) : (
                                <Visibility />
                              )}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />
                  </Grid>
                </Grid>
              </Grid>

              <Grid item xs={12} sm={3}>
                <Stack
                  direction="column"
                  justifyContent="center"
                  alignItems="stretch"
                  sx={{ height: "100%" }}
                >
                  {webdavChanged ||
                  webdav_url === null ||
                  webdav_username == null ||
                  webdav_password == null ? (
                    <Button
                      variant="contained"
                      color="primary"
                      sx={{ height: "100%" }}
                      type="submit"
                    >
                      Save
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      color="success"
                      sx={{ height: "100%" }}
                      onClick={handleBackup}
                      type="button"
                    >
                      Backup
                    </Button>
                  )}
                </Stack>
              </Grid>
            </Grid>
          </form>
          <Divider sx={{ marginY: 2 }} />
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>文件名称</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.length > 0 ? (
                  backups?.map((backup, index) => (
                    <TableRow key={index}>
                      <TableCell component="th" scope="row">
                        {backup.name}
                      </TableCell>
                      <TableCell align="right">
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                          }}
                        >
                          <IconButton
                            color="secondary"
                            aria-label="delete"
                            size="small"
                          >
                            <DeleteIcon />
                          </IconButton>
                          <Divider
                            orientation="vertical"
                            flexItem
                            sx={{ mx: 1, height: 24 }}
                          />

                          <IconButton
                            color="primary"
                            aria-label="restore"
                            size="small"
                          >
                            <RestoreIcon />
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={2} align="center">
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          height: 150,
                        }}
                      >
                        <Typography variant="body1" color="textSecondary">
                          暂无备份
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>
    </BaseDialog>
  );
});
