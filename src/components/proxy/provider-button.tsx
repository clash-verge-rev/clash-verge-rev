import { RefreshRounded, StorageOutlined } from "@mui/icons-material";
import {
  Box,
  Chip,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
  alpha,
  styled,
} from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateProxyProvider } from "tauri-plugin-mihomo-api";

import { useAppData } from "@/providers/app-data-context";
import { showNotice } from "@/services/noticeService";
import parseTraffic from "@/utils/parse-traffic";

// 样式化组件 - 类型框
const TypeBox = styled(Box)<{ component?: React.ElementType }>(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.secondary.main, 0.5),
  color: alpha(theme.palette.secondary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));

// 解析过期时间
const parseExpire = (expire?: number) => {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
};

export const ProviderButton = () => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const {
    proxyProviders,
    proxyHydration,
    refreshProxy,
    refreshProxyProviders,
  } = useAppData();

  const isHydrating = proxyHydration !== "live";
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  // 检查是否有提供者
  const hasProviders = Object.keys(proxyProviders || {}).length > 0;

  // Hydration hint badge keeps users aware of sync state
  const hydrationChip = useMemo(() => {
    if (proxyHydration === "live") return null;

    return (
      <Chip
        size="small"
        color={proxyHydration === "snapshot" ? "warning" : "info"}
        label={
          proxyHydration === "snapshot"
            ? t("Snapshot data")
            : t("Proxy data is syncing, please wait")
        }
        sx={{ fontWeight: 500 }}
      />
    );
  }, [proxyHydration, t]);

  // 更新单个代理提供者
  const updateProvider = useLockFn(async (name: string) => {
    if (isHydrating) {
      showNotice("info", t("Proxy data is syncing, please wait"));
      return;
    }

    try {
      // 设置更新状态
      setUpdating((prev) => ({ ...prev, [name]: true }));
      await updateProxyProvider(name);
      await refreshProxyProviders();
      await refreshProxy();
      showNotice(
        "success",
        t("Provider {{name}} updated successfully", { name }),
      );
    } catch (err: any) {
      showNotice(
        "error",
        t("Provider {{name}} update failed: {{message}}", {
          name,
          message: err?.message || err.toString(),
        }),
      );
    } finally {
      // 清除更新状态
      setUpdating((prev) => ({ ...prev, [name]: false }));
    }
  });

  // 更新所有代理提供者
  const updateAllProviders = useLockFn(async () => {
    if (isHydrating) {
      showNotice("info", t("Proxy data is syncing, please wait"));
      return;
    }

    try {
      // 获取所有provider的名称
      const allProviders = Object.keys(proxyProviders || {});
      if (allProviders.length === 0) {
        showNotice("info", t("No providers to update"));
        return;
      }

      // 设置所有provider为更新中状态
      const newUpdating = allProviders.reduce(
        (acc, key) => {
          acc[key] = true;
          return acc;
        },
        {} as Record<string, boolean>,
      );
      setUpdating(newUpdating);

      // 改为串行逐个更新所有provider
      for (const name of allProviders) {
        try {
          await updateProxyProvider(name);
          // 每个更新完成后更新状态
          setUpdating((prev) => ({ ...prev, [name]: false }));
        } catch (err) {
          console.error(`更新 ${name} 失败`, err);
          // 继续执行下一个，不中断整体流程
        }
      }

      await refreshProxyProviders();
      await refreshProxy();
      showNotice("success", t("All providers updated successfully"));
    } catch (err: any) {
      showNotice(
        "error",
        t("Failed to update providers: {{message}}", {
          message: err?.message || err.toString(),
        }),
      );
    } finally {
      // 清除所有更新状态
      setUpdating({});
    }
  });

  const handleClose = () => setOpen(false);

  if (!hasProviders) return null;

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mr: 1 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<StorageOutlined />}
          onClick={() => setOpen(true)}
          disabled={isHydrating}
          title={
            isHydrating ? t("Proxy data is syncing, please wait") : undefined
          }
        >
          {t("Proxy Provider")}
        </Button>
        {hydrationChip}
      </Box>

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="h6">{t("Proxy Provider")}</Typography>
            <Button
              variant="contained"
              size="small"
              onClick={updateAllProviders}
              disabled={isHydrating}
              title={
                isHydrating
                  ? t("Proxy data is syncing, please wait")
                  : undefined
              }
            >
              {t("Update All")}
            </Button>
          </Box>
        </DialogTitle>

        <DialogContent>
          <List sx={{ py: 0, minHeight: 250 }}>
            {Object.entries(proxyProviders || {})
              .sort()
              .map(([key, item]) => {
                if (!item) return null;

                const time = dayjs(item.updatedAt);
                const isUpdating = updating[key];
                const sub = item.subscriptionInfo;
                const hasSubInfo = Boolean(sub);
                const upload = sub?.Upload ?? 0;
                const download = sub?.Download ?? 0;
                const total = sub?.Total ?? 0;
                const expire = sub?.Expire ?? 0;
                const progress =
                  total > 0
                    ? Math.min(
                        100,
                        Math.max(0, ((upload + download) / total) * 100),
                      )
                    : 0;

                return (
                  <ListItem
                    key={key}
                    secondaryAction={
                      <Box
                        sx={{
                          width: 40,
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                        }}
                      >
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => updateProvider(key)}
                          disabled={isUpdating || isHydrating}
                          sx={{
                            animation: isUpdating
                              ? "spin 1s linear infinite"
                              : "none",
                            "@keyframes spin": {
                              "0%": { transform: "rotate(0deg)" },
                              "100%": { transform: "rotate(360deg)" },
                            },
                          }}
                          title={t("Update Provider") as string}
                        >
                          <RefreshRounded />
                        </IconButton>
                      </Box>
                    }
                    sx={{
                      mb: 1,
                      borderRadius: 1,
                      border: "1px solid",
                      borderColor: alpha("#ccc", 0.4),
                      backgroundColor: alpha("#fff", 0.02),
                    }}
                  >
                    <ListItemText
                      sx={{ px: 2, py: 1 }}
                      primary={
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 1,
                          }}
                        >
                          <Typography
                            variant="subtitle1"
                            component="div"
                            noWrap
                            title={key}
                            sx={{ display: "flex", alignItems: "center" }}
                          >
                            <span style={{ marginRight: 8 }}>{key}</span>
                            <TypeBox component="span">
                              {item.proxies.length}
                            </TypeBox>
                            <TypeBox component="span">
                              {item.vehicleType}
                            </TypeBox>
                          </Typography>

                          <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                          >
                            <small>{t("Update At")}: </small>
                            {time.fromNow()}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        hasSubInfo ? (
                          <>
                            <Box
                              sx={{
                                mb: 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <span title={t("Used / Total") as string}>
                                {parseTraffic(upload + download)} /{" "}
                                {parseTraffic(total)}
                              </span>
                              <span title={t("Expire Time") as string}>
                                {parseExpire(expire)}
                              </span>
                            </Box>

                            <LinearProgress
                              variant="determinate"
                              value={progress}
                              sx={{
                                height: 6,
                                borderRadius: 3,
                                opacity: total > 0 ? 1 : 0,
                              }}
                            />
                          </>
                        ) : null
                      }
                    />
                    <Divider orientation="vertical" flexItem />
                  </ListItem>
                );
              })}
          </List>
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} variant="outlined">
            {t("Close")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
