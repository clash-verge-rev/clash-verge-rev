import { BaseDialog, DialogRef } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import { showNotice } from "@/services/noticeService";
import {
  ContentCopy,
  RefreshRounded,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  CircularProgress,
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
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let password = "";

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    password += charset.charAt(randomIndex);
  }

  return password;
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
  const [isSaving, setIsSaving] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);

  const { clashInfo, patchInfo } = useClashInfo();

  const [controller, setController] = useState(clashInfo?.server || "");
  const [secret, setSecret] = useState(clashInfo?.secret || "");

  // 直接通过API重启内核
  const restartCoreDirectly = useLockFn(async () => {
    try {
      const controllerUrl = controller || clashInfo?.server || 'http://localhost:9090';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }

      const response = await fetch(`${controllerUrl}/restart`, {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to restart core');
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      } else {
        const text = await response.text();
        console.log('Non-JSON response:', text);
        return { message: 'Restart request sent successfully' };
      }
    } catch (err: any) {
      console.error('Error restarting core:', err);
      throw err;
    }
  });

  // 生成随机配置并重启内核
  const generateAndRestart = useLockFn(async () => {
    try {
      setIsRestarting(true);

      const port = generateRandomPort();
      const password = generateRandomPassword();

      const host = controller.split(':')[0] || '127.0.0.1';
      const newController = `${host}:${port}`;

      setController(newController);
      setSecret(password);

      // 更新配置
      await patchInfo({ "external-controller": newController, secret: password });

      // 直接重启内核
      await restartCoreDirectly();

      // 静默执行，不显示通知
    } catch (err: any) {
      showNotice('error', err.message || t("Failed to generate configuration or restart core"), 4000);
    } finally {
      setIsRestarting(false);
    }
  });

  // 仅在对话框打开时生成配置
  useImperativeHandle(ref, () => ({
    open: async () => {
      setOpen(true);

      if (autoGenerate) {
        await generateAndRestart();
      } else {
        setController(clashInfo?.server || "");
        setSecret(clashInfo?.secret || "");
      }
    },
    close: () => setOpen(false),
  }));

  // 当自动生成开关状态变化时触发
  useEffect(() => {
    if (autoGenerate && open) {
      generateAndRestart();
    }
  }, [autoGenerate, open]);

  // 保存函数（优化）
  const onSave = useLockFn(async () => {
    if (!controller.trim()) {
      showNotice('info', t("Controller address cannot be empty"), 3000);
      return;
    }

    try {
      setIsSaving(true);

      await patchInfo({ "external-controller": controller, secret });

      showNotice('success', t("Configuration saved successfully"), 2000);
      setOpen(false);
    } catch (err: any) {
      showNotice('error', err.message || t("Failed to save configuration"), 4000);
    } finally {
      setIsSaving(false);
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
      okBtn={
        isSaving ? (
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={16} color="inherit" />
            {t("Saving...")}
          </Box>
        ) : (
          t("Save")
        )
      }
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
                disabled={autoGenerate || isSaving || isRestarting}
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
              disabled={autoGenerate || isSaving || isRestarting}
            />
            {autoGenerate && (
              <Tooltip title={t("Copy to clipboard")}>
                <IconButton
                  size="small"
                  onClick={() => handleCopyToClipboard(controller, "controller")}
                  color="primary"
                  disabled={isSaving || isRestarting}
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
                disabled={autoGenerate || isSaving || isRestarting}
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
              disabled={autoGenerate || isSaving || isRestarting}
            />
            {autoGenerate && (
              <Tooltip title={t("Copy to clipboard")}>
                <IconButton
                  size="small"
                  onClick={() => handleCopyToClipboard(secret, "secret")}
                  color="primary"
                  disabled={isSaving || isRestarting}
                >
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px", display: "flex", justifyContent: "space-between" }}>
          <ListItemText
            primary={t("Auto Random Config")}
            secondary={
              autoGenerate
                ? t("Generate new config and restart core when entering settings")
                : t("Manual configuration")
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={autoGenerate}
                onChange={() => setAutoGenerate(!autoGenerate)}
                color="primary"
                disabled={isSaving || isRestarting}
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
