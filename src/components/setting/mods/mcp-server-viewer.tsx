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
import { useImperativeHandle, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/notice-service";

const DEFAULT_MCP_PORT = 9199;

export function McpServerViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState<null | string>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { verge, patchVerge } = useVerge();
  const [enabled, setEnabled] = useState(verge?.enable_mcp_server ?? false);
  const [port, setPort] = useState(
    String(verge?.mcp_server_port ?? DEFAULT_MCP_PORT),
  );
  const [secret, setSecret] = useState(verge?.mcp_server_secret ?? "");

  useImperativeHandle(ref, () => ({
    open: async () => {
      setOpen(true);
      setEnabled(verge?.enable_mcp_server ?? false);
      setPort(String(verge?.mcp_server_port ?? DEFAULT_MCP_PORT));
      setSecret(verge?.mcp_server_secret ?? "");
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      setIsSaving(true);

      const portNum = parseInt(port, 10);
      const validPort = !isNaN(portNum) && portNum > 0 && portNum < 65536;

      await patchVerge({
        enable_mcp_server: enabled,
        mcp_server_port: validPort ? portNum : DEFAULT_MCP_PORT,
        mcp_server_secret: secret || undefined,
      });

      showNotice.success(
        "settings.sections.mcpServer.messages.restartRequired",
      );
      setOpen(false);
    } catch (err) {
      showNotice.error(
        "shared.feedback.notifications.common.saveFailed",
        err,
        4000,
      );
    } finally {
      setIsSaving(false);
    }
  });

  const handleCopy = useLockFn(async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null));
    } catch {
      showNotice.error("settings.sections.mcpServer.messages.copyFailed");
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("settings.sections.mcpServer.title")}
      contentSx={{ width: 400 }}
      okBtn={
        isSaving ? (
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={16} color="inherit" />
            {t("shared.statuses.saving")}
          </Box>
        ) : (
          t("shared.actions.save")
        )
      }
      cancelBtn={t("shared.actions.cancel")}
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
          <ListItemText
            primary={t("settings.sections.mcpServer.fields.enable")}
          />
          <Switch
            edge="end"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={isSaving}
          />
        </ListItem>

        <ListItem
          sx={{
            padding: "5px 2px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <ListItemText
            primary={t("settings.sections.mcpServer.fields.port")}
          />
          <Box display="flex" alignItems="center" gap={1}>
            <TextField
              size="small"
              sx={{
                width: 175,
                opacity: enabled ? 1 : 0.5,
                pointerEvents: enabled ? "auto" : "none",
              }}
              value={port}
              placeholder={t("settings.sections.mcpServer.placeholders.port")}
              onChange={(e) => setPort(e.target.value)}
              disabled={isSaving || !enabled}
              type="number"
              inputProps={{ min: 1, max: 65535 }}
            />
            <Tooltip title={t("settings.sections.mcpServer.tooltips.copy")}>
              <IconButton
                size="small"
                onClick={() => handleCopy(port, "port")}
                color="primary"
                disabled={isSaving || !enabled}
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
          <ListItemText
            primary={t("settings.sections.mcpServer.fields.secret")}
          />
          <Box display="flex" alignItems="center" gap={1}>
            <TextField
              size="small"
              sx={{
                width: 175,
                opacity: enabled ? 1 : 0.5,
                pointerEvents: enabled ? "auto" : "none",
              }}
              value={secret}
              placeholder={t("settings.sections.mcpServer.placeholders.secret")}
              onChange={(e) => setSecret(e.target.value)}
              disabled={isSaving || !enabled}
            />
            <Tooltip title={t("settings.sections.mcpServer.tooltips.copy")}>
              <IconButton
                size="small"
                onClick={() => handleCopy(secret, "secret")}
                color="primary"
                disabled={isSaving || !enabled}
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
          {copySuccess === "port"
            ? t("settings.sections.mcpServer.messages.portCopied")
            : t("settings.sections.mcpServer.messages.secretCopied")}
        </Alert>
      </Snackbar>
    </BaseDialog>
  );
}
