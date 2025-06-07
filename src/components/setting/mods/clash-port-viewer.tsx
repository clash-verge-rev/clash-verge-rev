import { BaseDialog, Switch } from "@/components/base";
import { useClashInfo } from "@/hooks/use-clash";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/noticeService";
import getSystem from "@/utils/get-system";
import { Shuffle } from "@mui/icons-material";
import {
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
} from "@mui/material";
import { useLockFn, useRequest } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

const OS = getSystem();

interface ClashPortViewerProps {}

interface ClashPortViewerRef {
  open: () => void;
  close: () => void;
}

const generateRandomPort = () =>
  Math.floor(Math.random() * (65535 - 1025 + 1)) + 1025;

export const ClashPortViewer = forwardRef<
  ClashPortViewerRef,
  ClashPortViewerProps
>((props, ref) => {
  const { t } = useTranslation();
  const { clashInfo, patchInfo } = useClashInfo();
  const { verge, patchVerge } = useVerge();
  const [open, setOpen] = useState(false);

  // Mixed Port
  const [mixedPort, setMixedPort] = useState(
    verge?.verge_mixed_port ?? clashInfo?.mixed_port ?? 7897,
  );

  // 其他端口状态
  const [socksPort, setSocksPort] = useState(verge?.verge_socks_port ?? 7898);
  const [socksEnabled, setSocksEnabled] = useState(
    verge?.verge_socks_enabled ?? false,
  );
  const [httpPort, setHttpPort] = useState(verge?.verge_port ?? 7899);
  const [httpEnabled, setHttpEnabled] = useState(
    verge?.verge_http_enabled ?? false,
  );
  const [redirPort, setRedirPort] = useState(verge?.verge_redir_port ?? 7895);
  const [redirEnabled, setRedirEnabled] = useState(
    verge?.verge_redir_enabled ?? false,
  );
  const [tproxyPort, setTproxyPort] = useState(
    verge?.verge_tproxy_port ?? 7896,
  );
  const [tproxyEnabled, setTproxyEnabled] = useState(
    verge?.verge_tproxy_enabled ?? false,
  );

  // 添加保存请求，防止GUI卡死
  const { loading, run: saveSettings } = useRequest(
    async (params: { clashConfig: any; vergeConfig: any }) => {
      const { clashConfig, vergeConfig } = params;
      await Promise.all([patchInfo(clashConfig), patchVerge(vergeConfig)]);
    },
    {
      manual: true,
      onSuccess: () => {
        setOpen(false);
        showNotice("success", t("Port settings saved")); // 调用提示函数
      },
      onError: () => {
        showNotice("error", t("Failed to save settings")); // 调用提示函数
      },
    },
  );

  useImperativeHandle(ref, () => ({
    open: () => {
      setMixedPort(verge?.verge_mixed_port ?? clashInfo?.mixed_port ?? 7897);
      setSocksPort(verge?.verge_socks_port ?? 7898);
      setSocksEnabled(verge?.verge_socks_enabled ?? false);
      setHttpPort(verge?.verge_port ?? 7899);
      setHttpEnabled(verge?.verge_http_enabled ?? false);
      setRedirPort(verge?.verge_redir_port ?? 7895);
      setRedirEnabled(verge?.verge_redir_enabled ?? false);
      setTproxyPort(verge?.verge_tproxy_port ?? 7896);
      setTproxyEnabled(verge?.verge_tproxy_enabled ?? false);
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    // 端口冲突检测
    const portList = [
      mixedPort,
      socksEnabled ? socksPort : -1,
      httpEnabled ? httpPort : -1,
      redirEnabled ? redirPort : -1,
      tproxyEnabled ? tproxyPort : -1,
    ].filter((p) => p !== -1);

    if (new Set(portList).size !== portList.length) {
      return;
    }

    // 验证端口范围
    const isValidPort = (port: number) => port >= 1 && port <= 65535;
    const allPortsValid = [
      mixedPort,
      socksEnabled ? socksPort : 0,
      httpEnabled ? httpPort : 0,
      redirEnabled ? redirPort : 0,
      tproxyEnabled ? tproxyPort : 0,
    ].every((port) => port === 0 || isValidPort(port));

    if (!allPortsValid) {
      return;
    }

    // 准备配置数据
    const clashConfig = {
      "mixed-port": mixedPort,
      "socks-port": socksPort,
      port: httpPort,
      "redir-port": redirPort,
      "tproxy-port": tproxyPort,
    };

    const vergeConfig = {
      verge_mixed_port: mixedPort,
      verge_socks_port: socksPort,
      verge_socks_enabled: socksEnabled,
      verge_port: httpPort,
      verge_http_enabled: httpEnabled,
      verge_redir_port: redirPort,
      verge_redir_enabled: redirEnabled,
      verge_tproxy_port: tproxyPort,
      verge_tproxy_enabled: tproxyEnabled,
    };

    // 提交保存请求
    await saveSettings({ clashConfig, vergeConfig });
  });

  // 优化的数字输入处理
  const handleNumericChange =
    (setter: (value: number) => void) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.replace(/\D+/, "");
      if (value === "") {
        setter(0);
        return;
      }

      const num = parseInt(value, 10);
      if (!isNaN(num) && num >= 0 && num <= 65535) {
        setter(num);
      }
    };

  return (
    <BaseDialog
      open={open}
      title={t("Port Configuration")}
      contentSx={{
        width: 400,
      }}
      okBtn={
        loading ? (
          <Stack direction="row" alignItems="center" spacing={1}>
            <CircularProgress size={20} />
            {t("Saving...")}
          </Stack>
        ) : (
          t("Save")
        )
      }
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List sx={{ width: "100%" }}>
        <ListItem sx={{ padding: "4px 0", minHeight: 36 }}>
          <ListItemText
            primary={t("Mixed Port")}
            primaryTypographyProps={{ fontSize: 12 }}
          />
          <div style={{ display: "flex", alignItems: "center" }}>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={mixedPort}
              onChange={(e) =>
                setMixedPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
              }
              inputProps={{ style: { fontSize: 12 } }}
            />
            <IconButton
              size="small"
              onClick={() => setMixedPort(generateRandomPort())}
              title={t("Random Port")}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <Switch
              size="small"
              checked={true}
              disabled={true}
              sx={{ ml: 0.5, opacity: 0.7 }}
            />
          </div>
        </ListItem>

        <ListItem sx={{ padding: "4px 0", minHeight: 36 }}>
          <ListItemText
            primary={t("Socks Port")}
            primaryTypographyProps={{ fontSize: 12 }}
          />
          <div style={{ display: "flex", alignItems: "center" }}>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={socksPort}
              onChange={(e) =>
                setSocksPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
              }
              disabled={!socksEnabled}
              inputProps={{ style: { fontSize: 12 } }}
            />
            <IconButton
              size="small"
              onClick={() => setSocksPort(generateRandomPort())}
              title={t("Random Port")}
              disabled={!socksEnabled}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <Switch
              size="small"
              checked={socksEnabled}
              onChange={(_, c) => setSocksEnabled(c)}
              sx={{ ml: 0.5 }}
            />
          </div>
        </ListItem>

        <ListItem sx={{ padding: "4px 0", minHeight: 36 }}>
          <ListItemText
            primary={t("Http Port")}
            primaryTypographyProps={{ fontSize: 12 }}
          />
          <div style={{ display: "flex", alignItems: "center" }}>
            <TextField
              size="small"
              sx={{ width: 80, mr: 0.5, fontSize: 12 }}
              value={httpPort}
              onChange={(e) =>
                setHttpPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
              }
              disabled={!httpEnabled}
              inputProps={{ style: { fontSize: 12 } }}
            />
            <IconButton
              size="small"
              onClick={() => setHttpPort(generateRandomPort())}
              title={t("Random Port")}
              disabled={!httpEnabled}
              sx={{ mr: 0.5 }}
            >
              <Shuffle fontSize="small" />
            </IconButton>
            <Switch
              size="small"
              checked={httpEnabled}
              onChange={(_, c) => setHttpEnabled(c)}
              sx={{ ml: 0.5 }}
            />
          </div>
        </ListItem>

        {OS !== "windows" && (
          <ListItem sx={{ padding: "4px 0", minHeight: 36 }}>
            <ListItemText
              primary={t("Redir Port")}
              primaryTypographyProps={{ fontSize: 12 }}
            />
            <div style={{ display: "flex", alignItems: "center" }}>
              <TextField
                size="small"
                sx={{ width: 80, mr: 0.5, fontSize: 12 }}
                value={redirPort}
                onChange={(e) =>
                  setRedirPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
                }
                disabled={!redirEnabled}
                inputProps={{ style: { fontSize: 12 } }}
              />
              <IconButton
                size="small"
                onClick={() => setRedirPort(generateRandomPort())}
                title={t("Random Port")}
                disabled={!redirEnabled}
                sx={{ mr: 0.5 }}
              >
                <Shuffle fontSize="small" />
              </IconButton>
              <Switch
                size="small"
                checked={redirEnabled}
                onChange={(_, c) => setRedirEnabled(c)}
                sx={{ ml: 0.5 }}
              />
            </div>
          </ListItem>
        )}

        {OS === "linux" && (
          <ListItem sx={{ padding: "4px 0", minHeight: 36 }}>
            <ListItemText
              primary={t("Tproxy Port")}
              primaryTypographyProps={{ fontSize: 12 }}
            />
            <div style={{ display: "flex", alignItems: "center" }}>
              <TextField
                size="small"
                sx={{ width: 80, mr: 0.5, fontSize: 12 }}
                value={tproxyPort}
                onChange={(e) =>
                  setTproxyPort(+e.target.value?.replace(/\D+/, "").slice(0, 5))
                }
                disabled={!tproxyEnabled}
                inputProps={{ style: { fontSize: 12 } }}
              />
              <IconButton
                size="small"
                onClick={() => setTproxyPort(generateRandomPort())}
                title={t("Random Port")}
                disabled={!tproxyEnabled}
                sx={{ mr: 0.5 }}
              >
                <Shuffle fontSize="small" />
              </IconButton>
              <Switch
                size="small"
                checked={tproxyEnabled}
                onChange={(_, c) => setTproxyEnabled(c)}
                sx={{ ml: 0.5 }}
              />
            </div>
          </ListItem>
        )}
      </List>
    </BaseDialog>
  );
});
