import {
  forwardRef,
  useImperativeHandle,
  useState,
  useRef,
  SVGProps,
} from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { Typography } from "@mui/material";
import { useForm } from "react-hook-form";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { isValidUrl } from "@/utils/helper";
import getSystem from "@/utils/get-system";
import { BaseLoadingOverlay } from "@/components/base";
import dayjs, { Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(customParseFormat);

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
  TablePagination,
} from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import DeleteIcon from "@mui/icons-material/Delete";
import RestoreIcon from "@mui/icons-material/Restore";

import {
  createWebdavBackup,
  listWebDavBackup,
  saveWebdavConfig,
} from "@/services/cmds";

type BackupFile = IWebDavFile & {
  platform: string;
  backup_time: Dayjs;
  allow_apply: boolean;
};

export const BackupViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { verge, mutateVerge } = useVerge();
  const { webdav_url, webdav_username, webdav_password } = verge || {};
  const [showPassword, setShowPassword] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  const OS = getSystem();
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

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      if (webdav_url && webdav_username && webdav_password) {
        fetchAndSetBackupFiles();
      }
    },
    close: () => setOpen(false),
  }));

  // Handle page change
  const handleChangePage = (
    _: React.MouseEvent<HTMLButtonElement> | null,
    page: number
  ) => {
    console.log(page);
    setPage(page);
  };

  // Handle rows per page change
  const handleChangeRowsPerPage = (event: any) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0); // Reset to the first page
  };

  const fetchAndSetBackupFiles = () => {
    setIsLoading(true); // Assuming setIsLoading is defined in your component or context to manage loading state

    getAllBackupFiles()
      .then((files: BackupFile[]) => {
        console.log(files);
        setBackupFiles(files); // Assuming setBackupFiles is a state setter function in your component or context
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

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
        fetchAndSetBackupFiles();
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
        fetchAndSetBackupFiles();
      })
      .catch((e) => {
        console.log(e, "backup failed");
        Notice.error(t("Backup Failed", { error: e }), 3000);
      });
  });

  const getAllBackupFiles = async () => {
    const files = await listWebDavBackup();
    return files
      .map((file) => {
        const platform = file.filename.split("-")[0];
        const fileBackupTimeStr = file.filename.match(
          /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/
        )!;
        const backupTime = dayjs(fileBackupTimeStr[0], "YYYY-MM-DD_HH-mm-ss");
        const allowApply = OS === platform;
        return {
          ...file,
          platform,
          backup_time: backupTime,
          allow_apply: allowApply,
        } as BackupFile;
      })
      .sort((a, b) => (a.backup_time.isAfter(b.backup_time) ? -1 : 1));
  };

  const datasource = backupFiles.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

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
                  <TableCell>时间</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {datasource.length > 0 ? (
                  datasource?.map((file, index) => (
                    <TableRow key={index}>
                      <TableCell component="th" scope="row">
                        {file.platform === "windows" ? (
                          <WindowsIcon className="h-full w-full" />
                        ) : file.platform === "linux" ? (
                          <LinuxIcon className="h-full w-full" />
                        ) : (
                          <MacIcon className="h-full w-full" />
                        )}
                        {file.filename}
                      </TableCell>
                      <TableCell align="center">
                        {file.backup_time.fromNow()}
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
                    <TableCell colSpan={3} align="center">
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          height: 150,
                        }}
                      >
                        <Typography
                          variant="body1"
                          color="textSecondary"
                          align="center"
                        >
                          暂无备份
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <TablePagination
              rowsPerPageOptions={[]}
              component="div"
              count={backupFiles.length}
              rowsPerPage={rowsPerPage}
              page={page}
              onPageChange={handleChangePage}
              onRowsPerPageChange={handleChangeRowsPerPage}
              labelRowsPerPage=""
            />
          </TableContainer>
        </Paper>
      </Box>
    </BaseDialog>
  );
});

export function LinuxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 48 48"
      {...props}
    >
      <path
        fill="#ECEFF1"
        d="m20.1 16.2l.1 2.3l-1.6 3l-2.5 4.9l-.5 4.1l1.8 5.8l4.1 2.3h6.2l5.8-4.4l2.6-6.9l-6-7.3l-1.7-4.1z"
      />
      <path
        fill="#263238"
        d="M34.3 21.9c-1.6-2.3-2.9-3.7-3.6-6.6s.2-2.1-.4-4.6c-.3-1.3-.8-2.2-1.3-2.9c-.6-.7-1.3-1.1-1.7-1.2c-.9-.5-3-1.3-5.6.1c-2.7 1.4-2.4 4.4-1.9 10.5c0 .4-.1.9-.3 1.3c-.4.9-1.1 1.7-1.7 2.4c-.7 1-1.4 2-1.9 3.1c-1.2 2.3-2.3 5.2-2 6.3c.5-.1 6.8 9.5 6.8 9.7c.4-.1 2.1-.1 3.6-.1c2.1-.1 3.3-.2 5 .2c0-.3-.1-.6-.1-.9c0-.6.1-1.1.2-1.8c.1-.5.2-1 .3-1.6c-1 .9-2.8 1.9-4.5 2.2c-1.5.3-4-.2-5.2-1.7c.1 0 .3 0 .4-.1c.3-.1.6-.2.7-.4c.3-.5.1-1-.1-1.3s-1.7-1.4-2.4-2s-1.1-.9-1.5-1.3l-.8-.8c-.2-.2-.3-.4-.4-.5c-.2-.5-.3-1.1-.2-1.9c.1-1.1.5-2 1-3c.2-.4.7-1.2.7-1.2s-1.7 4.2-.8 5.5c0 0 .1-1.3.5-2.6c.3-.9.8-2.2 1.4-2.9s2.1-3.3 2.2-4.9c0-.7.1-1.4.1-1.9c-.4-.4 6.6-1.4 7-.3c.1.4 1.5 4 2.3 5.9c.4.9.9 1.7 1.2 2.7c.3 1.1.5 2.6.5 4.1c0 .3 0 .8-.1 1.3c.2 0 4.1-4.2-.5-7.7c0 0 2.8 1.3 2.9 3.9c.1 2.1-.8 3.8-1 4.1c.1 0 2.1.9 2.2.9c.4 0 1.2-.3 1.2-.3c.1-.3.4-1.1.4-1.4c.7-2.3-1-6-2.6-8.3"
      />
      <g fill="#ECEFF1" transform="translate(0 -2)">
        <ellipse cx="21.6" cy="15.3" rx="1.3" ry="2" />
        <ellipse cx="26.1" cy="15.2" rx="1.7" ry="2.3" />
      </g>
      <g fill="#212121" transform="translate(0 -2)">
        <ellipse
          cx="21.7"
          cy="15.5"
          rx="1.2"
          ry=".7"
          transform="rotate(-97.204 21.677 15.542)"
        />
        <ellipse cx="26" cy="15.6" rx="1" ry="1.3" />
      </g>
      <path
        fill="#FFC107"
        d="M39.3 35.6c-.4-.2-1.1-.5-1.7-1.4c-.3-.5-.2-1.9-.7-2.5c-.3-.4-.7-.2-.8-.2c-.9.2-3 1.6-4.4 0c-.2-.2-.5-.5-1-.5s-.7.2-.9.6s-.2.7-.2 1.7c0 .8 0 1.7-.1 2.4c-.2 1.7-.5 2.7-.5 3.7c0 1.1.3 1.8.7 2.1c.3.3.8.5 1.9.5s1.8-.4 2.5-1.1c.5-.5.9-.7 2.3-1.7c1.1-.7 2.8-1.6 3.1-1.9c.2-.2.5-.3.5-.9c0-.5-.4-.7-.7-.8m-20.1.3c-1-1.6-1.1-1.9-1.8-2.9c-.6-1-1.9-2.9-2.7-2.9c-.6 0-.9.3-1.3.7s-.8 1.3-1.5 1.8c-.6.5-2.3.4-2.7 1s.4 1.5.4 3c0 .6-.5 1-.6 1.4c-.1.5-.2.8 0 1.2c.4.6.9.8 4.3 1.5c1.8.4 3.5 1.4 4.6 1.5s3 0 3-2.7c.1-1.6-.8-2-1.7-3.6m1.9-18.1c-.6-.4-1.1-.8-1.1-1.4s.4-.8 1-1.3c.1-.1 1.2-1.1 2.3-1.1s2.4.7 2.9.9c.9.2 1.8.4 1.7 1.1c-.1 1-.2 1.2-1.2 1.7c-.7.2-2 1.3-2.9 1.3c-.4 0-1 0-1.4-.1c-.3-.1-.8-.6-1.3-1.1"
      />
      <path
        fill="#634703"
        d="M20.9 17c.2.2.5.4.8.5c.2.1.5.2.5.2h.9c.5 0 1.2-.2 1.9-.6c.7-.3.8-.5 1.3-.7c.5-.3 1-.6.8-.7s-.4 0-1.1.4c-.6.4-1.1.6-1.7.9c-.3.1-.7.3-1 .3h-.9c-.3 0-.5-.1-.8-.2c-.2-.1-.3-.2-.4-.2c-.2-.1-.6-.5-.8-.6c0 0-.2 0-.1.1zm3-2.2c.1.2.3.2.4.3s.2.1.2.1c.1-.1 0-.3-.1-.3c0-.2-.5-.2-.5-.1m-1.6.2c0 .1.2.2.2.1c.1-.1.2-.2.3-.2c.2-.1.1-.2-.2-.2c-.2.1-.2.2-.3.3"
      />
      <path
        fill="#455A64"
        d="M32 32.7v.3c.2.4.7.5 1.1.5c.6 0 1.2-.4 1.5-.8c0-.1.1-.2.2-.3c.2-.3.3-.5.4-.6c0 0-.1-.1-.1-.2c-.1-.2-.4-.4-.8-.5c-.3-.1-.8-.2-1-.2c-.9-.1-1.4.2-1.7.5c0 0 .1 0 .1.1c.2.2.3.4.3.7c.1.2 0 .3 0 .5"
      />
    </svg>
  );
}

export function WindowsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      {...props}
    >
      <path
        fill="#0284c7"
        d="M6.555 1.375L0 2.237v5.45h6.555zM0 13.795l6.555.933V8.313H0zm7.278-5.4l.026 6.378L16 16V8.395zM16 0L7.33 1.244v6.414H16z"
      />
    </svg>
  );
}

export function MacIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 26 26"
      {...props}
    >
      <path
        fill="#000"
        d="M23.934 18.947c-.598 1.324-.884 1.916-1.652 3.086c-1.073 1.634-2.588 3.673-4.461 3.687c-1.666.014-2.096-1.087-4.357-1.069c-2.261.011-2.732 1.089-4.4 1.072c-1.873-.017-3.307-1.854-4.381-3.485c-3.003-4.575-3.32-9.937-1.464-12.79C4.532 7.425 6.61 6.237 8.561 6.237c1.987 0 3.236 1.092 4.879 1.092c1.594 0 2.565-1.095 4.863-1.095c1.738 0 3.576.947 4.889 2.581c-4.296 2.354-3.598 8.49.742 10.132M16.559 4.408c.836-1.073 1.47-2.587 1.24-4.131c-1.364.093-2.959.964-3.891 2.092c-.844 1.027-1.544 2.553-1.271 4.029c1.488.048 3.028-.839 3.922-1.99"
      />
    </svg>
  );
}
