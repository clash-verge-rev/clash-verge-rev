import {
  AccessTimeOutlined,
  CancelOutlined,
  CheckCircleOutlined,
  HelpOutline,
  PendingOutlined,
  RefreshRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useLockFn } from "ahooks";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseEmpty, BasePage } from "@/components/base";
import { showNotice } from "@/services/noticeService";

interface UnlockItem {
  name: string;
  status: string;
  region?: string | null;
  check_time?: string | null;
}

const UNLOCK_RESULTS_STORAGE_KEY = "clash_verge_unlock_results";
const UNLOCK_RESULTS_TIME_KEY = "clash_verge_unlock_time";

const UnlockPage = () => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [unlockItems, setUnlockItems] = useState<UnlockItem[]>([]);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [loadingItems, setLoadingItems] = useState<string[]>([]);

  const sortItemsByName = useCallback((items: UnlockItem[]) => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  // 保存测试结果到本地存储
  const saveResultsToStorage = (items: UnlockItem[], time: string | null) => {
    try {
      localStorage.setItem(UNLOCK_RESULTS_STORAGE_KEY, JSON.stringify(items));
      if (time) {
        localStorage.setItem(UNLOCK_RESULTS_TIME_KEY, time);
      }
    } catch (err) {
      console.error("Failed to save results to storage:", err);
    }
  };

  const loadResultsFromStorage = (): {
    items: UnlockItem[] | null;
    time: string | null;
  } => {
    try {
      const itemsJson = localStorage.getItem(UNLOCK_RESULTS_STORAGE_KEY);
      const time = localStorage.getItem(UNLOCK_RESULTS_TIME_KEY);

      if (itemsJson) {
        return {
          items: JSON.parse(itemsJson) as UnlockItem[],
          time,
        };
      }
    } catch (err) {
      console.error("Failed to load results from storage:", err);
    }

    return { items: null, time: null };
  };

  const getUnlockItems = useCallback(
    async (updateUI: boolean = true) => {
      try {
        const items = await invoke<UnlockItem[]>("get_unlock_items");
        const sortedItems = sortItemsByName(items);

        if (updateUI) {
          setUnlockItems(sortedItems);
        }
      } catch (err: any) {
        console.error("Failed to get unlock items:", err);
      }
    },
    [sortItemsByName],
  );

  useEffect(() => {
    const { items: storedItems } = loadResultsFromStorage();

    if (storedItems && storedItems.length > 0) {
      setUnlockItems(storedItems);
      getUnlockItems(false);
    } else {
      getUnlockItems(true);
    }
  }, [getUnlockItems]);

  const invokeWithTimeout = async <T,>(
    cmd: string,
    args?: any,
    timeout = 15000,
  ): Promise<T> => {
    return Promise.race([
      invoke<T>(cmd, args),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(t("Detection timeout or failed"))),
          timeout,
        ),
      ),
    ]);
  };

  // 执行全部项目检测
  const checkAllMedia = useLockFn(async () => {
    try {
      setIsCheckingAll(true);
      const result =
        await invokeWithTimeout<UnlockItem[]>("check_media_unlock");
      const sortedItems = sortItemsByName(result);

      setUnlockItems(sortedItems);
      const currentTime = new Date().toLocaleString();

      saveResultsToStorage(sortedItems, currentTime);

      setIsCheckingAll(false);
    } catch (err: any) {
      setIsCheckingAll(false);
      showNotice(
        "error",
        err?.message || err?.toString() || t("Detection timeout or failed"),
      );
      console.error("Failed to check media unlock:", err);
    }
  });

  // 检测单个流媒体服务
  const checkSingleMedia = useLockFn(async (name: string) => {
    try {
      setLoadingItems((prev) => [...prev, name]);
      const result =
        await invokeWithTimeout<UnlockItem[]>("check_media_unlock");

      const targetItem = result.find((item: UnlockItem) => item.name === name);

      if (targetItem) {
        const updatedItems = sortItemsByName(
          unlockItems.map((item: UnlockItem) =>
            item.name === name ? targetItem : item,
          ),
        );

        setUnlockItems(updatedItems);
        const currentTime = new Date().toLocaleString();

        saveResultsToStorage(updatedItems, currentTime);
      }

      setLoadingItems((prev) => prev.filter((item) => item !== name));
    } catch (err: any) {
      setLoadingItems((prev) => prev.filter((item) => item !== name));
      showNotice(
        "error",
        err?.message ||
          err?.toString() ||
          t("Detection failed for {name}").replace("{name}", name),
      );
      console.error(`Failed to check ${name}:`, err);
    }
  });

  // 状态颜色
  const getStatusColor = (status: string) => {
    if (status === "Pending") return "default";
    if (status === "Yes") return "success";
    if (status === "No") return "error";
    if (status === "Soon") return "warning";
    if (status.includes("Failed")) return "error";
    if (status === "Completed") return "info";
    if (
      status === "Disallowed ISP" ||
      status === "Blocked" ||
      status === "Unsupported Country/Region"
    ) {
      return "error";
    }
    return "default";
  };

  // 状态图标
  const getStatusIcon = (status: string) => {
    if (status === "Pending") return <PendingOutlined />;
    if (status === "Yes") return <CheckCircleOutlined />;
    if (status === "No") return <CancelOutlined />;
    if (status === "Soon") return <AccessTimeOutlined />;
    if (status.includes("Failed")) return <HelpOutline />;
    return <HelpOutline />;
  };

  // 边框色
  const getStatusBorderColor = (status: string) => {
    if (status === "Yes") return theme.palette.success.main;
    if (status === "No") return theme.palette.error.main;
    if (status === "Soon") return theme.palette.warning.main;
    if (status.includes("Failed")) return theme.palette.error.main;
    if (status === "Completed") return theme.palette.info.main;
    return theme.palette.divider;
  };

  const isDark = theme.palette.mode === "dark";

  return (
    <BasePage
      title={t("Unlock Test")}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            disabled={isCheckingAll}
            onClick={checkAllMedia}
            startIcon={
              isCheckingAll ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <RefreshRounded />
              )
            }
          >
            {isCheckingAll ? t("Testing...") : t("Test All")}
          </Button>
        </Box>
      }
    >
      {unlockItems.length === 0 ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "50%",
          }}
        >
          <BaseEmpty text={t("No unlock test items")} />
        </Box>
      ) : (
        <Grid container spacing={1.5} columns={{ xs: 1, sm: 2, md: 3 }}>
          {unlockItems.map((item) => (
            <Grid size={1} key={item.name}>
              <Card
                variant="outlined"
                sx={{
                  height: "100%",
                  borderRadius: 2,
                  borderLeft: `4px solid ${getStatusBorderColor(item.status)}`,
                  backgroundColor: isDark ? "#282a36" : "#ffffff",
                  position: "relative",
                  overflow: "hidden",
                  "&:hover": {
                    backgroundColor: isDark
                      ? alpha(theme.palette.primary.dark, 0.05)
                      : alpha(theme.palette.primary.light, 0.05),
                  },
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <Box sx={{ p: 1.3, flex: 1 }}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{
                        fontWeight: 600,
                        fontSize: "1rem",
                        color: "text.primary",
                      }}
                    >
                      {item.name}
                    </Typography>
                    <Tooltip title={t("Test")}>
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          disabled={
                            loadingItems.includes(item.name) || isCheckingAll
                          }
                          sx={{
                            minWidth: "32px",
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                          }}
                          onClick={() => checkSingleMedia(item.name)}
                        >
                          <RefreshRounded
                            sx={{
                              animation: loadingItems.includes(item.name)
                                ? "spin 1s linear infinite"
                                : "none",
                              "@keyframes spin": {
                                "0%": { transform: "rotate(0deg)" },
                                "100%": { transform: "rotate(360deg)" },
                              },
                            }}
                          />
                        </Button>
                      </span>
                    </Tooltip>
                  </Box>

                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 1,
                    }}
                  >
                    <Chip
                      label={t(item.status)}
                      color={getStatusColor(item.status)}
                      size="small"
                      icon={getStatusIcon(item.status)}
                      sx={{
                        fontWeight:
                          item.status === "Pending" ? "normal" : "bold",
                      }}
                    />

                    {item.region && (
                      <Chip
                        label={item.region}
                        size="small"
                        variant="outlined"
                        color="info"
                      />
                    )}
                  </Box>
                </Box>

                <Divider
                  sx={{
                    borderStyle: "dashed",
                    borderColor: alpha(theme.palette.divider, 0.2),
                    mx: 1,
                  }}
                />

                <Box sx={{ px: 1.5, py: 0.2 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      color: "text.secondary",
                      fontSize: "0.7rem",
                      textAlign: "right",
                    }}
                  >
                    {item.check_time || "-- --"}
                  </Typography>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </BasePage>
  );
};

export default UnlockPage;
