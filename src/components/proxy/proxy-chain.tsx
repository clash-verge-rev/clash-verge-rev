import { useState, useCallback, useEffect, useRef } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Chip,
  Alert,
  useTheme,
  Button,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppData } from "@/providers/app-data-provider";
import {
  updateProxyChainConfigInRuntime,
  updateProxyAndSync,
  getProxies,
  closeAllConnections,
} from "@/services/cmds";
import useSWR from "swr";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Delete as DeleteIcon,
  DragIndicator,
  ClearAll,
  Save,
  Link,
  LinkOff,
} from "@mui/icons-material";

interface ProxyChainItem {
  id: string;
  name: string;
  type?: string;
  delay?: number;
}

interface ParsedChainConfig {
  proxies?: Array<{
    name: string;
    type: string;
    [key: string]: any;
  }>;
}

interface ProxyChainProps {
  proxyChain: ProxyChainItem[];
  onUpdateChain: (chain: ProxyChainItem[]) => void;
  chainConfigData?: string | null;
  onMarkUnsavedChanges?: () => void;
}

interface SortableItemProps {
  proxy: ProxyChainItem;
  index: number;
  onRemove: (id: string) => void;
}

const SortableItem = ({ proxy, index, onRemove }: SortableItemProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: proxy.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        mb: 1,
        display: "flex",
        alignItems: "center",
        p: 1,
        backgroundColor: isDragging
          ? theme.palette.action.selected
          : theme.palette.background.default,
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: isDragging ? theme.shadows[4] : theme.shadows[1],
        transition: "box-shadow 0.2s, background-color 0.2s",
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          display: "flex",
          alignItems: "center",
          mr: 1,
          color: theme.palette.text.secondary,
          cursor: "grab",
          "&:active": {
            cursor: "grabbing",
          },
        }}
      >
        <DragIndicator />
      </Box>

      <Chip
        label={`${index + 1}`}
        size="small"
        color="primary"
        sx={{ mr: 1, minWidth: 32 }}
      />

      <Typography
        variant="body2"
        sx={{
          flex: 1,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {proxy.name}
      </Typography>

      {proxy.type && (
        <Chip
          label={proxy.type}
          size="small"
          variant="outlined"
          sx={{ mr: 1 }}
        />
      )}

      {proxy.delay !== undefined && (
        <Chip
          label={proxy.delay > 0 ? `${proxy.delay}ms` : t("timeout") || "超时"}
          size="small"
          color={
            proxy.delay > 0 && proxy.delay < 200
              ? "success"
              : proxy.delay > 0 && proxy.delay < 800
                ? "warning"
                : "error"
          }
          sx={{ mr: 1, fontSize: "0.7rem", minWidth: 50 }}
        />
      )}

      <IconButton
        size="small"
        onClick={() => onRemove(proxy.id)}
        sx={{
          color: theme.palette.error.main,
          "&:hover": {
            backgroundColor: theme.palette.error.light + "20",
          },
        }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export const ProxyChain = ({
  proxyChain,
  onUpdateChain,
  chainConfigData,
  onMarkUnsavedChanges,
}: ProxyChainProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { proxies } = useAppData();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // 获取当前代理信息以检查连接状态
  const { data: currentProxies, mutate: mutateProxies } = useSWR(
    "getProxies",
    getProxies,
    {
      revalidateOnFocus: true,
      revalidateIfStale: true,
      refreshInterval: 5000, // 每5秒刷新一次
    },
  );

  // 检查连接状态
  useEffect(() => {
    if (!currentProxies || proxyChain.length < 2) {
      setIsConnected(false);
      return;
    }

    // 查找 proxy_chain 代理组
    const proxyChainGroup = currentProxies.groups.find(
      (group) => group.name === "proxy_chain",
    );
    if (!proxyChainGroup || !proxyChainGroup.now) {
      setIsConnected(false);
      return;
    }

    // 获取用户配置的最后一个节点
    const lastNode = proxyChain[proxyChain.length - 1];

    // 检查当前选中的代理是否是配置的最后一个节点
    if (proxyChainGroup.now === lastNode.name) {
      setIsConnected(true);
    } else {
      setIsConnected(false);
    }
  }, [currentProxies, proxyChain]);

  // 监听链的变化，但排除从配置加载的情况
  const chainLengthRef = useRef(proxyChain.length);
  useEffect(() => {
    // 只有当链长度发生变化且不是初始加载时，才标记为未保存
    if (
      chainLengthRef.current !== proxyChain.length &&
      chainLengthRef.current !== 0
    ) {
      setHasUnsavedChanges(true);
    }
    chainLengthRef.current = proxyChain.length;
  }, [proxyChain.length]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (active.id !== over?.id) {
        const oldIndex = proxyChain.findIndex((item) => item.id === active.id);
        const newIndex = proxyChain.findIndex((item) => item.id === over?.id);

        onUpdateChain(arrayMove(proxyChain, oldIndex, newIndex));
        setHasUnsavedChanges(true);
      }
    },
    [proxyChain, onUpdateChain],
  );

  const handleRemoveProxy = useCallback(
    (id: string) => {
      const newChain = proxyChain.filter((item) => item.id !== id);
      onUpdateChain(newChain);
      setHasUnsavedChanges(true);
    },
    [proxyChain, onUpdateChain],
  );

  const handleClearAll = useCallback(() => {
    onUpdateChain([]);
    setHasUnsavedChanges(true);
  }, [onUpdateChain]);

  const handleConnect = useCallback(async () => {
    if (isConnected) {
      // 如果已连接，则断开连接
      setIsConnecting(true);
      try {
        // 清空链式代理配置
        await updateProxyChainConfigInRuntime(null);

        // 切换到 DIRECT 模式断开代理连接
        // await updateProxyAndSync("GLOBAL", "DIRECT");

        // 关闭所有连接
        await closeAllConnections();

        // 刷新代理信息以更新连接状态
        mutateProxies();

        // 清空链式代理配置UI
        // onUpdateChain([]);
        // setHasUnsavedChanges(false);

        // 强制更新连接状态
        setIsConnected(false);
      } catch (error) {
        console.error("Failed to disconnect from proxy chain:", error);
        alert(t("Failed to disconnect from proxy chain") || "断开链式代理失败");
      } finally {
        setIsConnecting(false);
      }
      return;
    }

    if (proxyChain.length < 2) {
      alert(
        t("Chain proxy requires at least 2 nodes") || "链式代理至少需要2个节点",
      );
      return;
    }

    setIsConnecting(true);
    try {
      // 第一步：保存链式代理配置
      const chainProxies = proxyChain.map((node) => node.name);
      console.log("Saving chain config:", chainProxies);
      await updateProxyChainConfigInRuntime(chainProxies);
      console.log("Chain configuration saved successfully");

      // 第二步：连接到代理链的最后一个节点
      const lastNode = proxyChain[proxyChain.length - 1];
      console.log(`Connecting to proxy chain, last node: ${lastNode.name}`);
      await updateProxyAndSync("proxy_chain", lastNode.name);

      // 刷新代理信息以更新连接状态
      mutateProxies();

      // 清除未保存标记
      setHasUnsavedChanges(false);

      console.log("Successfully connected to proxy chain");
    } catch (error) {
      console.error("Failed to connect to proxy chain:", error);
      alert(t("Failed to connect to proxy chain") || "连接链式代理失败");
    } finally {
      setIsConnecting(false);
    }
  }, [proxyChain, isConnected, t, mutateProxies]);

  const proxyChainRef = useRef(proxyChain);
  const onUpdateChainRef = useRef(onUpdateChain);

  useEffect(() => {
    proxyChainRef.current = proxyChain;
    onUpdateChainRef.current = onUpdateChain;
  }, [proxyChain, onUpdateChain]);

  // 处理链式代理配置数据
  useEffect(() => {
    if (chainConfigData) {
      try {
        // Try to parse as YAML using dynamic import
        import("js-yaml")
          .then((yaml) => {
            try {
              const parsedConfig = yaml.load(
                chainConfigData,
              ) as ParsedChainConfig;
              const chainItems =
                parsedConfig?.proxies?.map((proxy, index: number) => ({
                  id: `${proxy.name}_${Date.now()}_${index}`,
                  name: proxy.name,
                  type: proxy.type,
                  delay: undefined,
                })) || [];
              onUpdateChain(chainItems);
              setHasUnsavedChanges(false);
            } catch (parseError) {
              console.error("Failed to parse YAML:", parseError);
              onUpdateChain([]);
            }
          })
          .catch((importError) => {
            // Fallback: try to parse as JSON if YAML is not available
            console.warn(
              "js-yaml not available, trying JSON parse:",
              importError,
            );
            try {
              const parsedConfig = JSON.parse(
                chainConfigData,
              ) as ParsedChainConfig;
              const chainItems =
                parsedConfig?.proxies?.map((proxy, index: number) => ({
                  id: `${proxy.name}_${Date.now()}_${index}`,
                  name: proxy.name,
                  type: proxy.type,
                  delay: undefined,
                })) || [];
              onUpdateChain(chainItems);
              setHasUnsavedChanges(false);
            } catch (jsonError) {
              console.error("Failed to parse as JSON either:", jsonError);
              onUpdateChain([]);
            }
          });
      } catch (error) {
        console.error("Failed to process chain config data:", error);
        onUpdateChain([]);
      }
    } else if (chainConfigData === "") {
      // Empty string means no proxies available, show empty state
      onUpdateChain([]);
      setHasUnsavedChanges(false);
    }
  }, [chainConfigData, onUpdateChain]);

  // 定时更新延迟数据
  useEffect(() => {
    if (!proxies?.records) return;

    const updateDelays = () => {
      const currentChain = proxyChainRef.current;
      if (currentChain.length === 0) return;

      const updatedChain = currentChain.map((item) => {
        const proxyRecord = proxies.records[item.name];
        if (
          proxyRecord &&
          proxyRecord.history &&
          proxyRecord.history.length > 0
        ) {
          const latestDelay =
            proxyRecord.history[proxyRecord.history.length - 1].delay;
          return { ...item, delay: latestDelay };
        }
        return item;
      });

      // 只有在延迟数据确实发生变化时才更新
      const hasChanged = updatedChain.some(
        (item, index) => item.delay !== currentChain[index]?.delay,
      );

      if (hasChanged) {
        onUpdateChainRef.current(updatedChain);
      }
    };

    // 立即更新一次延迟
    updateDelays();

    // 设置定时器，每5秒更新一次延迟
    const interval = setInterval(updateDelays, 5000);

    return () => clearInterval(interval);
  }, [proxies?.records]); // 只依赖proxies.records

  return (
    <Paper
      elevation={1}
      sx={{
        height: "100%",
        p: 2,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Typography variant="h6">{t("Chain Proxy Config")}</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {proxyChain.length > 0 && (
            <IconButton
              size="small"
              onClick={() => {
                updateProxyChainConfigInRuntime(null);
                onUpdateChain([]);
                setHasUnsavedChanges(false);
              }}
              sx={{
                color: theme.palette.error.main,
                "&:hover": {
                  backgroundColor: theme.palette.error.light + "20",
                },
              }}
              title={t("Delete Chain Config") || "删除链式配置"}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={isConnected ? <LinkOff /> : <Link />}
            onClick={handleConnect}
            disabled={isConnecting || proxyChain.length < 2}
            color={isConnected ? "error" : "success"}
            sx={{
              minWidth: 90,
            }}
            title={
              proxyChain.length < 2
                ? t("Chain proxy requires at least 2 nodes") ||
                  "链式代理至少需要2个节点"
                : undefined
            }
          >
            {isConnecting
              ? t("Connecting...") || "连接中..."
              : isConnected
                ? t("Disconnect") || "断开"
                : t("Connect") || "连接"}
          </Button>
        </Box>
      </Box>

      <Alert
        severity={proxyChain.length === 1 ? "warning" : "info"}
        sx={{ mb: 2 }}
      >
        {proxyChain.length === 1
          ? t(
              "Chain proxy requires at least 2 nodes. Please add one more node.",
            ) || "链式代理至少需要2个节点，请再添加一个节点。"
          : t("Click nodes in order to add to proxy chain") ||
            "按顺序点击节点添加到代理链中"}
      </Alert>

      <Box sx={{ flex: 1, overflow: "auto" }}>
        {proxyChain.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: theme.palette.text.secondary,
            }}
          >
            <Typography>{t("No proxy chain configured")}</Typography>
          </Box>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={proxyChain.map((proxy) => proxy.id)}
              strategy={verticalListSortingStrategy}
            >
              <Box
                sx={{
                  borderRadius: 1,
                  minHeight: 60,
                  p: 1,
                }}
              >
                {proxyChain.map((proxy, index) => (
                  <SortableItem
                    key={proxy.id}
                    proxy={proxy}
                    index={index}
                    onRemove={handleRemoveProxy}
                  />
                ))}
              </Box>
            </SortableContext>
          </DndContext>
        )}
      </Box>
    </Paper>
  );
};
