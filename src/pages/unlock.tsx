import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  Divider,
  Typography,
  Chip,
  Tooltip,
  CircularProgress,
  alpha,
  useTheme,
} from "@mui/material";
import Grid from "@mui/material/Grid2";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { BasePage, BaseEmpty } from "@/components/base";
import { useLockFn } from "ahooks";
import {
  CheckCircleOutlined,
  CancelOutlined,
  HelpOutline,
  PendingOutlined,
  RefreshRounded,
  AccessTimeOutlined,
} from "@mui/icons-material";

// 定义流媒体检测项类型
interface UnlockItem {
  name: string;
  status: string;
  region?: string | null;
  check_time?: string | null;
}

// 用于存储测试结果的本地存储键名
const UNLOCK_RESULTS_STORAGE_KEY = "clash_verge_unlock_results";
const UNLOCK_RESULTS_TIME_KEY = "clash_verge_unlock_time";

const UnlockPage = () => {
  const { t } = useTranslation();
  const theme = useTheme();

  // 保存所有流媒体检测项的状态
  const [unlockItems, setUnlockItems] = useState<UnlockItem[]>([]);
  // 是否正在执行全部检测
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  // 记录正在检测中的项目
  const [loadingItems, setLoadingItems] = useState<string[]>([]);
  // 最后检测时间
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);

  // 按首字母排序项目
  const sortItemsByName = (items: UnlockItem[]) => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  };

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

  // 从本地存储加载测试结果
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

  // 页面加载时获取初始检测项列表
  useEffect(() => {
    // 尝试从本地存储加载上次测试结果
    const { items: storedItems, time } = loadResultsFromStorage();

    if (storedItems && storedItems.length > 0) {
      // 如果有存储的结果，优先使用
      setUnlockItems(storedItems);
      setLastCheckTime(time);

      // 后台同时获取最新的初始状态（但不更新UI）
      getUnlockItems(false);
    } else {
      // 没有存储的结果，获取初始状态
      getUnlockItems(true);
    }
  }, []);

  // 获取所有解锁检测项列表
  const getUnlockItems = async (updateUI: boolean = true) => {
    try {
      const items = await invoke<UnlockItem[]>("get_unlock_items");
      const sortedItems = sortItemsByName(items);

      if (updateUI) {
        setUnlockItems(sortedItems);
      }
    } catch (err: any) {
      console.error("Failed to get unlock items:", err);
    }
  };

  // 执行全部项目检测
  const checkAllMedia = useLockFn(async () => {
    try {
      setIsCheckingAll(true);
      const result = await invoke<UnlockItem[]>("check_media_unlock");
      const sortedItems = sortItemsByName(result);

      // 更新UI
      setUnlockItems(sortedItems);
      const currentTime = new Date().toLocaleString();
      setLastCheckTime(currentTime);

      // 保存结果到本地存储
      saveResultsToStorage(sortedItems, currentTime);

      setIsCheckingAll(false);
    } catch (err: any) {
      setIsCheckingAll(false);
      console.error("Failed to check media unlock:", err);
    }
  });

  // 根据项目名称检测单个流媒体服务
  const checkSingleMedia = useLockFn(async (name: string) => {
    try {
      // 将该项目添加到加载状态
      setLoadingItems((prev) => [...prev, name]);

      // 执行检测
      const result = await invoke<UnlockItem[]>("check_media_unlock");

      // 找到对应的检测结果
      const targetItem = result.find((item: UnlockItem) => item.name === name);

      if (targetItem) {
        // 更新单个检测项结果并按名称排序
        const updatedItems = sortItemsByName(
          unlockItems.map((item: UnlockItem) =>
            item.name === name ? targetItem : item,
          ),
        );

        // 更新UI
        setUnlockItems(updatedItems);
        const currentTime = new Date().toLocaleString();
        setLastCheckTime(currentTime);

        // 保存结果到本地存储
        saveResultsToStorage(updatedItems, currentTime);
      }

      // 移除加载状态
      setLoadingItems((prev) => prev.filter((item) => item !== name));
    } catch (err: any) {
      setLoadingItems((prev) => prev.filter((item) => item !== name));
      console.error(`Failed to check ${name}:`, err);
    }
  });

  // 获取状态对应的颜色
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
      status === "Unsupported Country"
    ) {
      return "error";
    }
    return "default";
  };

  // 获取状态对应的图标
  const getStatusIcon = (status: string) => {
    if (status === "Pending") return <PendingOutlined />;
    if (status === "Yes") return <CheckCircleOutlined />;
    if (status === "No") return <CancelOutlined />;
    if (status === "Soon") return <AccessTimeOutlined />;
    if (status.includes("Failed")) return <HelpOutline />;
    return <HelpOutline />;
  };

  // 获取状态对应的背景色
  const getStatusBgColor = (status: string) => {
    if (status === "Yes") return alpha(theme.palette.success.main, 0.05);
    if (status === "No") return alpha(theme.palette.error.main, 0.05);
    if (status === "Soon") return alpha(theme.palette.warning.main, 0.05);
    if (status.includes("Failed")) return alpha(theme.palette.error.main, 0.03);
    if (status === "Completed") return alpha(theme.palette.info.main, 0.05);
    return "transparent";
  };

  // 获取状态对应的边框色
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
            <Grid size={1}>
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
                            //p: 0,
                            borderRadius: "50%",
                          }}
                          onClick={() => checkSingleMedia(item.name)}
                        >
                          {loadingItems.includes(item.name) ? (
                            <CircularProgress size={16} />
                          ) : (
                            <RefreshRounded fontSize="small" />
                          )}
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
