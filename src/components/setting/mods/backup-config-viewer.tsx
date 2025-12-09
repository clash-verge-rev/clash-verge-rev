import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import {
  TextField,
  Button,
  Grid,
  Stack,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { useState, useRef, memo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { useVerge } from "@/hooks/use-verge";
import { saveWebdavConfig, createWebdavBackup } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import { isValidUrl } from "@/utils/helper";

interface BackupConfigViewerProps {
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

    const handleClickShowPassword = () => {
      setShowPassword((prev) => !prev);
    };

    useEffect(() => {
      if (!webdav_url || !webdav_username || !webdav_password) {
        return;
      }
      void onInit();
    }, [webdav_url, webdav_username, webdav_password, onInit]);

    const checkForm = () => {
      const username = usernameRef.current?.value;
      const password = passwordRef.current?.value;
      const url = urlRef.current?.value;

      if (!url) {
        urlRef.current?.focus();
        showNotice.error("settings.modals.backup.messages.webdavUrlRequired");
        throw new Error(t("settings.modals.backup.messages.webdavUrlRequired"));
      } else if (!isValidUrl(url)) {
        urlRef.current?.focus();
        showNotice.error("settings.modals.backup.messages.invalidWebdavUrl");
        throw new Error(t("settings.modals.backup.messages.invalidWebdavUrl"));
      }
      if (!username) {
        usernameRef.current?.focus();
        showNotice.error("settings.modals.backup.messages.usernameRequired");
        throw new Error(t("settings.modals.backup.messages.usernameRequired"));
      }
      if (!password) {
        passwordRef.current?.focus();
        showNotice.error("settings.modals.backup.messages.passwordRequired");
        throw new Error(t("settings.modals.backup.messages.passwordRequired"));
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
          showNotice.success(
            "settings.modals.backup.messages.webdavConfigSaved",
          );
          onSaveSuccess();
        });
      } catch (error) {
        showNotice.error(
          "settings.modals.backup.messages.webdavConfigSaveFailed",
          { error },
          3000,
        );
      } finally {
        setLoading(false);
      }
    });

    const handleBackup = useLockFn(async () => {
      checkForm();
      try {
        setLoading(true);
        await createWebdavBackup().then(async () => {
          showNotice.success("settings.modals.backup.messages.backupCreated");
          await onBackupSuccess();
        });
      } catch (error) {
        showNotice.error("settings.modals.backup.messages.backupFailed", {
          error,
        });
      } finally {
        setLoading(false);
      }
    });

    return (
      <form onSubmit={(e) => e.preventDefault()}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 9 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  label={t("settings.modals.backup.fields.webdavUrl")}
                  variant="outlined"
                  size="small"
                  {...register("url")}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  inputRef={urlRef}
                  sx={{ mt: 1 }}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label={t("settings.modals.backup.fields.username")}
                  variant="outlined"
                  size="small"
                  {...register("username")}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  inputRef={usernameRef}
                />
              </Grid>
              <Grid size={{ xs: 6 }}>
                <TextField
                  label={t("shared.labels.password")}
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
              </Grid>
            </Grid>
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
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
                  {t("shared.actions.save")}
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
                    {t("settings.modals.backup.actions.backup")}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={onRefresh}
                    type="button"
                    size="large"
                  >
                    {t("shared.actions.refresh")}
                  </Button>
                </>
              )}
            </Stack>
          </Grid>
        </Grid>
      </form>
    );
  },
);
