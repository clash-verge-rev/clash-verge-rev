import { useState, useRef, memo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { useVerge } from "@/hooks/use-verge";
import { Notice } from "@/components/base";
import { isValidUrl } from "@/utils/helper";
import { useLockFn } from "ahooks";
import {
  TextField,
  Button,
  Grid2,
  Box,
  Stack,
  IconButton,
  InputAdornment,
} from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { saveWebdavConfig, createWebdavBackup } from "@/services/cmds";

export interface BackupConfigViewerProps {
  onBackupSuccess: () => Promise<void>;
  onSaveSuccess: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onInit: () => Promise<void>;
  setLoading: (loading: boolean) => void;
}

export const BackupConfigViewer = memo(
  ({
    onBackupSuccess,
    onSaveSuccess,
    onRefresh,
    onInit,
    setLoading,
  }: BackupConfigViewerProps) => {
    const { t } = useTranslation();
    const { verge } = useVerge();
    const { webdav_url, webdav_username, webdav_password } = verge || {};
    const [showPassword, setShowPassword] = useState(false);
    const usernameRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const urlRef = useRef<HTMLInputElement>(null);

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

    console.log(
      "webdavChanged",
      webdavChanged,
      webdav_url,
      webdav_username,
      webdav_password,
    );

    const handleClickShowPassword = () => {
      setShowPassword((prev) => !prev);
    };

    useEffect(() => {
      if (webdav_url && webdav_username && webdav_password) {
        onInit();
      }
    }, []);

    const checkForm = () => {
      const username = usernameRef.current?.value;
      const password = passwordRef.current?.value;
      const url = urlRef.current?.value;

      if (!url) {
        urlRef.current?.focus();
        Notice.error(t("WebDAV URL Required"));
        throw new Error(t("WebDAV URL Required"));
      } else if (!isValidUrl(url)) {
        urlRef.current?.focus();
        Notice.error(t("Invalid WebDAV URL"));
        throw new Error(t("Invalid WebDAV URL"));
      }
      if (!username) {
        usernameRef.current?.focus();
        Notice.error(t("WebDAV URL Required"));
        throw new Error(t("Username Required"));
      }
      if (!password) {
        passwordRef.current?.focus();
        Notice.error(t("WebDAV URL Required"));
        throw new Error(t("Password Required"));
      }
    };

    const save = useLockFn(async (data: IWebDavConfig) => {
      checkForm();
      try {
        setLoading(true);
        await saveWebdavConfig(
          data.url.trim(),
          data.username.trim(),
          data.password,
        ).then(() => {
          Notice.success(t("WebDAV Config Saved"));
          onSaveSuccess();
        });
      } catch (error) {
        Notice.error(t("WebDAV Config Save Failed", { error }), 3000);
      } finally {
        setLoading(false);
      }
    });

    const handleBackup = useLockFn(async () => {
      checkForm();
      try {
        setLoading(true);
        await createWebdavBackup().then(async () => {
          await onBackupSuccess();
          Notice.success(t("Backup Created"));
        });
      } catch (error) {
        Notice.error(t("Backup Failed", { error }));
      } finally {
        setLoading(false);
      }
    });

    return (
      <form onSubmit={(e) => e.preventDefault()}>
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, sm: 9 }}>
            <Grid2 container spacing={2}>
              <Grid2 size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  label={t("WebDAV Server URL")}
                  variant="outlined"
                  size="small"
                  {...register("url")}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  inputRef={urlRef}
                />
              </Grid2>
              <Grid2 size={{ xs: 6 }}>
                <TextField
                  label={t("Username")}
                  variant="outlined"
                  size="small"
                  {...register("username")}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  inputRef={usernameRef}
                />
              </Grid2>
              <Grid2 size={{ xs: 6 }}>
                <TextField
                  label={t("Password")}
                  type={showPassword ? "text" : "password"}
                  variant="outlined"
                  size="small"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  inputRef={passwordRef}
                  {...register("password")}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={handleClickShowPassword}
                            edge="end"
                          >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Grid2>
            </Grid2>
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 3 }}>
            <Stack
              direction="column"
              justifyContent="space-between"
              alignItems="stretch"
              sx={{ height: "100%" }}
            >
              {webdavChanged ||
              webdav_url === undefined ||
              webdav_username === undefined ||
              webdav_password === undefined ? (
                <Button
                  variant="contained"
                  color={"primary"}
                  sx={{ height: "100%" }}
                  type="button"
                  onClick={handleSubmit(save)}
                >
                  {t("Save")}
                </Button>
              ) : (
                <>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={handleBackup}
                    type="button"
                    size="large"
                  >
                    {t("Backup")}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={onRefresh}
                    type="button"
                    size="large"
                  >
                    {t("Refresh")}
                  </Button>
                </>
              )}
            </Stack>
          </Grid2>
        </Grid2>
      </form>
    );
  },
);
