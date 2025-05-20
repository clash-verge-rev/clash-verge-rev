import { BaseDialog, DialogRef } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import { showNotice } from "@/services/noticeService";
import {
  ContentCopy,
  RefreshRounded
} from "@mui/icons-material";
import {
  Alert,
  Box,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  Switch,
  TextField,
  Tooltip
} from "@mui/material";
import { useLocalStorageState, useLockFn } from "ahooks";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

// 随机端口和密码生成
const generateRandomPort = (): number => {
  return Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
};

const generateRandomPassword = (length: number = 32): string => {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:'\",.<>/?";
  let password = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    password += charset.charAt(randomIndex);
  }

  return password;
};

// 初始化执行一次随机生成
const useAppInitialization = (autoGenerate: boolean, onGenerate: () => void) => {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && autoGenerate) {
      onGenerate();
      setInitialized(true);
    }
  }, [initialized, autoGenerate, onGenerate]);
};

export const ControllerViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // 防止数值null
  const [autoGenerateState, setAutoGenerate] = useLocalStorageState<boolean>(
    'autoGenerateConfig',
    { defaultValue: false as boolean }
  );
  const autoGenerate = autoGenerateState!;

  const [copySuccess, setCopySuccess] = useState<null | string>(null);

  const { clashInfo, patchInfo } = useClashInfo();

  const [controller, setController] = useState(clashInfo?.server || "");
  const [secret, setSecret] = useState(clashInfo?.secret || "");

  // 初始化生成随机配置
  useAppInitialization(autoGenerate, () => {
    const port = generateRandomPort();
    const password = generateRandomPassword();

    const host = controller.split(':')[0] || '127.0.0.1';
    const newController = `${host}:${port}`;

    setController(newController);
    setSecret(password);

    patchInfo({ "external-controller": newController, secret: password });

    showNotice('info', t("Auto generated new config on startup"), 1000);
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setController(clashInfo?.server || "");
      setSecret(clashInfo?.secret || "");
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      await patchInfo({ "external-controller": controller, secret });
      showNotice('success', t("External Controller Address Modified"), 1000);
      setOpen(false);
    } catch (err: any) {
      showNotice('error', err.message || err.toString(), 4000);
    }
  });

  // 生成随机端口
  const handleGeneratePort = useLockFn(async () => {
    if (!autoGenerate) {
      const port = generateRandomPort();
      const host = controller.split(':')[0] || '127.0.0.1';
      setController(`${host}:${port}`);
      showNotice('success', t("Random port generated"), 1000);
    }
    return Promise.resolve();
  });

  // 生成随机 Secret
  const handleGenerateSecret = useLockFn(async () => {
    if (!autoGenerate) {
      const password = generateRandomPassword();
      setSecret(password);
      showNotice('success', t("Random secret generated"), 1000);
    }
    return Promise.resolve();
  });

  // 复制到剪贴板
  const handleCopyToClipboard = useLockFn(async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      showNotice('error', t("Failed to copy"), 2000);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("External Controller")}
      contentSx={{ width: 400 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px", display: "flex", justifyContent: "space-between" }}>
          <Box display="flex" alignItems="center" gap={1}>
            <ListItemText primary={t("External Controller")} />
            <Tooltip title={t("Generate Random Port")}>
              <IconButton
                size="small"
                onClick={handleGeneratePort}
                color="primary"
                disabled={autoGenerate}
              >
                <RefreshRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <TextField
              autoComplete="new-password"
              size="small"
              sx={{ width: 175, opacity: autoGenerate ? 0.7 : 1 }}
              value={controller}
              placeholder="Required"
              onChange={(e) => setController(e.target.value)}
              disabled={autoGenerate}
            />
            {autoGenerate && (

              <Tooltip title={t("Copy to clipboard")}>
                <IconButton
                  size="small"
                  onClick={() => handleCopyToClipboard(controller, "controller")}
                  color="primary"
                >
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px", display: "flex", justifyContent: "space-between" }}>
          <Box display="flex" alignItems="center" gap={1}>
            <ListItemText primary={t("Core Secret")} />
            <Tooltip title={t("Generate Random Secret")}>
              <IconButton
                size="small"
                onClick={handleGenerateSecret}
                color="primary"
                disabled={autoGenerate}
              >
                <RefreshRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box display="flex" alignItems="center" gap={1}>
            <TextField
              autoComplete="new-password"
              size="small"
              sx={{ width: 175, opacity: autoGenerate ? 0.7 : 1 }}
              value={secret}
              placeholder={t("Recommended")}
              onChange={(e) =>
                setSecret(e.target.value?.replace(/[^\x00-\x7F]/g, ""))
              }
              disabled={autoGenerate}
            />
            {autoGenerate && (
              <Tooltip title={t("Copy to clipboard")}>
                <IconButton
                  size="small"
                  onClick={() => handleCopyToClipboard(secret, "secret")}
                  color="primary"
                >
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px", display: "flex", justifyContent: "space-between" }}>
          <ListItemText primary={t("Auto Random Config")} secondary={
            autoGenerate
              ? t("Automatically generate new config on application startup")
              : t("Manual configuration")
          } />
          <FormControlLabel
            control={
              <Switch
                checked={autoGenerate}
                onChange={() => setAutoGenerate(!autoGenerate)}
                color="primary"
              />
            }
            label={autoGenerate ? t("On") : t("Off")}
            labelPlacement="start"
          />
        </ListItem>
      </List>

      <Snackbar
        open={copySuccess !== null}
        autoHideDuration={2000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity="success"
          sx={{ width: '100%' }}
        >
          {copySuccess === "controller"
            ? t("Controller address copied to clipboard")
            : t("Secret copied to clipboard")
          }
        </Alert>
      </Snackbar>
    </BaseDialog>
  );
});
