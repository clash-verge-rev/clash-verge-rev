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
import { showNotice } from "@/services/notice-service";

interface UnlockItem {
  name: string;
  status: string;
  region?: string | null;
  check_time?: string | null;
}

const UNLOCK_RESULTS_STORAGE_KEY = "clash_verge_unlock_results";
const UNLOCK_RESULTS_TIME_KEY = "clash_verge_unlock_time";

const STATUS_LABEL_KEYS: Record<string, string> = {
  Pending: "tests.statuses.test.pending",
  Yes: "tests.statuses.test.yes",
  No: "tests.statuses.test.no",
  Failed: "tests.statuses.test.failed",
  Completed: "tests.statuses.test.completed",
  "Disallowed ISP": "tests.statuses.test.disallowedIsp",
  "Originals Only": "tests.statuses.test.originalsOnly",
  "No (IP Banned By Disney+)": "tests.statuses.test.noDisney",
  "Unsupported Country/Region": "tests.statuses.test.unsupportedRegion",
  "Failed (Network Connection)": "tests.statuses.test.failedNetwork",
};

const normalizeUnlockName = (name: string) => name.trim().toLowerCase();

const getStatusPriority = (status: string) => (status === "Pending" ? 0 : 1);
const mergeOptionalFields = (preferred: UnlockItem, fallback: UnlockItem) => ({
  ...preferred,
  region: preferred.region ?? fallback.region,
  check_time: preferred.check_time ?? fallback.check_time,
});

const dedupeUnlockItems = (items: UnlockItem[]) => {
  const map = new Map<string, UnlockItem>();

  items.forEach((item) => {
    const key = normalizeUnlockName(item.name);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      return;
    }

    const existingPriority = getStatusPriority(existing.status);
    const itemPriority = getStatusPriority(item.status);

    if (itemPriority > existingPriority) {
      map.set(key, mergeOptionalFields(item, existing));
      return;
    }

    if (itemPriority < existingPriority) {
      map.set(key, mergeOptionalFields(existing, item));
      return;
    }

    map.set(key, mergeOptionalFields(item, existing));
  });

  return Array.from(map.values());
};

const UnlockPage = () => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [unlockItems, setUnlockItems] = useState<UnlockItem[]>([]);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [loadingItems, setLoadingItems] = useState<string[]>([]);

  const sortItemsByName = useCallback((items: UnlockItem[]) => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const mergeUnlockItems = useCallback(
    (defaults: UnlockItem[], existing?: UnlockItem[] | null) => {
      if (!existing || existing.length === 0) {
        return defaults;
      }

      const normalizedExisting = dedupeUnlockItems(existing);
      const existingMap = new Map(
        normalizedExisting.map((item) => [
          normalizeUnlockName(item.name),
          item,
        ]),
      );
      const merged = defaults.map((item) => {
        const normalizedName = normalizeUnlockName(item.name);
        const matchedItem = existingMap.get(normalizedName);
        if (matchedItem) {
          return { ...matchedItem, name: item.name };
        }
        return item;
      });

      const mergedNameSet = new Set(
        merged.map((item) => normalizeUnlockName(item.name)),
      );
      normalizedExisting.forEach((item) => {
        const normalizedName = normalizeUnlockName(item.name);
        if (!mergedNameSet.has(normalizedName)) {
          merged.push(item);
          mergedNameSet.add(normalizedName);
        }
      });

      return merged;
    },
    [],
  );

  // 保存测试结果到本地存储
  const saveResultsToStorage = useCallback(
    (items: UnlockItem[], time: string | null) => {
      try {
        localStorage.setItem(UNLOCK_RESULTS_STORAGE_KEY, JSON.stringify(items));
        if (time) {
          localStorage.setItem(UNLOCK_RESULTS_TIME_KEY, time);
        }
      } catch (err) {
        console.error("Failed to save results to storage:", err);
      }
    },
    [],
  );

  const loadResultsFromStorage = useCallback((): {
    items: UnlockItem[] | null;
    time: string | null;
  } => {
    try {
      const itemsJson = localStorage.getItem(UNLOCK_RESULTS_STORAGE_KEY);
      const time = localStorage.getItem(UNLOCK_RESULTS_TIME_KEY);

      if (itemsJson) {
        const parsedItems = JSON.parse(itemsJson) as UnlockItem[];
        return {
          items: dedupeUnlockItems(parsedItems),
          time,
        };
      }
    } catch (err) {
      console.error("Failed to load results from storage:", err);
    }

    return { items: null, time: null };
  }, []);

  const getUnlockItems = useCallback(
    async (
      existingItems: UnlockItem[] | null = null,
      existingTime: string | null = null,
    ) => {
      try {
        const defaultItems = await invoke<UnlockItem[]>("get_unlock_items");
        const mergedItems = mergeUnlockItems(defaultItems, existingItems);
        const sortedItems = sortItemsByName(mergedItems);

        setUnlockItems(sortedItems);
        saveResultsToStorage(
          sortedItems,
          existingItems && existingItems.length > 0 ? existingTime : null,
        );
      } catch (err: any) {
        console.error("Failed to get unlock items:", err);
      }
    },
    [mergeUnlockItems, saveResultsToStorage, sortItemsByName],
  );

  useEffect(() => {
    void (async () => {
      const { items: storedItems, time: storedTime } = loadResultsFromStorage();

      if (storedItems && storedItems.length > 0) {
        setUnlockItems(sortItemsByName(storedItems));
        await getUnlockItems(storedItems, storedTime);
      } else {
        await getUnlockItems();
      }
    })();
  }, [getUnlockItems, loadResultsFromStorage, sortItemsByName]);

  const invokeWithTimeout = async <T,>(
    cmd: string,
    args?: any,
    timeout = 15000,
  ): Promise<T> => {
    return Promise.race([
      invoke<T>(cmd, args),
      new Promise<T>((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(t("tests.unlock.page.messages.detectionTimeout"))),
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
      const sortedItems = sortItemsByName(dedupeUnlockItems(result));

      setUnlockItems(sortedItems);
      const currentTime = new Date().toLocaleString();

      saveResultsToStorage(sortedItems, currentTime);

      setIsCheckingAll(false);
    } catch (err: any) {
      setIsCheckingAll(false);
      showNotice.error("tests.unlock.page.messages.detectionTimeout", err);
      console.error("Failed to check media unlock:", err);
    }
  });

  // 检测单个流媒体服务
  const checkSingleMedia = useLockFn(async (name: string) => {
    try {
      setLoadingItems((prev) => [...prev, name]);
      const result =
        await invokeWithTimeout<UnlockItem[]>("check_media_unlock");
      const dedupedResult = dedupeUnlockItems(result);

      const normalizedTargetName = normalizeUnlockName(name);
      const targetItem = dedupedResult.find(
        (item: UnlockItem) =>
          normalizeUnlockName(item.name) === normalizedTargetName,
      );

      if (targetItem) {
        const updatedItems = sortItemsByName(
          dedupeUnlockItems(
            unlockItems.map((item: UnlockItem) =>
              normalizeUnlockName(item.name) === normalizedTargetName
                ? targetItem
                : item,
            ),
          ),
        );

        setUnlockItems(updatedItems);
        const currentTime = new Date().toLocaleString();

        saveResultsToStorage(updatedItems, currentTime);
      }

      setLoadingItems((prev) => prev.filter((item) => item !== name));
    } catch (err: any) {
      setLoadingItems((prev) => prev.filter((item) => item !== name));
      showNotice.error(
        "tests.unlock.page.messages.detectionFailedWithName",
        { name },
        err,
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
      title={t("tests.unlock.page.title")}
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
            {isCheckingAll
              ? t("tests.unlock.page.actions.testing")
              : t("tests.page.actions.testAll")}
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
          <BaseEmpty textKey="tests.unlock.page.empty" />
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
                    <Tooltip title={t("tests.components.item.actions.test")}>
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
                      label={t(STATUS_LABEL_KEYS[item.status] ?? item.status)}
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
