import { BaseDialog, DialogRef } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import { showNotice } from "@/services/noticeService";
import { ContentCopy } from "@mui/icons-material";
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  TextField,
  Tooltip,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

export const ControllerViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState<null | string>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { clashInfo, patchInfo } = useClashInfo();
  const [controller, setController] = useState(clashInfo?.server || "");
  const [secret, setSecret] = useState(clashInfo?.secret || "");

  // 对话框打开时初始化配置
  useImperativeHandle(ref, () => ({
    open: async () => {
      setOpen(true);
      setController(clashInfo?.server || "");
      setSecret(clashInfo?.secret || "");
    },
    close: () => setOpen(false),
  }));

  // 保存配置
  const onSave = useLockFn(async () => {
    if (!controller.trim()) {
      showNotice("error", t("Controller address cannot be empty"));
      return;
    }

    if (!secret.trim()) {
      showNotice("error", t("Secret cannot be empty"));
      return;
    }

    try {
      setIsSaving(true);
      await patchInfo({ "external-controller": controller, secret });
      showNotice("success", t("Configuration saved successfully"));
      setOpen(false);
    } catch (err: any) {
      showNotice(
        "error",
        err.message || t("Failed to save configuration"),
        4000,
      );
    } finally {
      setIsSaving(false);
    }
  });

  // 复制到剪贴板
  const handleCopyToClipboard = useLockFn(
    async (text: string, type: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopySuccess(type);
        setTimeout(() => setCopySuccess(null));
      } catch (err) {
        showNotice("error", t("Failed to copy"));
      }
    },
  );

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
        <ListItem
          sx={{
            padding: "5px 2px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <ListItemText primary={t("External Controller")} />
          <Box display="flex" alignItems="center" gap={1}>
            <TextField
              size="small"
              sx={{
                width: 175,
                opacity: 1,
                pointerEvents: "auto",
              }}
              value={controller}
              placeholder="Required"
              onChange={(e) => setController(e.target.value)}
              disabled={isSaving}
            />
            <Tooltip title={t("Copy to clipboard")}>
              <IconButton
                size="small"
                onClick={() => handleCopyToClipboard(controller, "controller")}
                color="primary"
                disabled={isSaving}
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </ListItem>

        <ListItem
          sx={{
            padding: "5px 2px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <ListItemText primary={t("Core Secret")} />
          <Box display="flex" alignItems="center" gap={1}>
            <TextField
              size="small"
              sx={{
                width: 175,
                opacity: 1,
                pointerEvents: "auto",
              }}
              value={secret}
              placeholder={t("Recommended")}
              onChange={(e) => setSecret(e.target.value)}
              disabled={isSaving}
            />
            <Tooltip title={t("Copy to clipboard")}>
              <IconButton
                size="small"
                onClick={() => handleCopyToClipboard(secret, "secret")}
                color="primary"
                disabled={isSaving}
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </ListItem>
      </List>

      <Snackbar
        open={copySuccess !== null}
        autoHideDuration={2000}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert severity="success">
          {copySuccess === "controller"
            ? t("Controller address copied to clipboard")
            : t("Secret copied to clipboard")}
        </Alert>
      </Snackbar>
    </BaseDialog>
  );
});
