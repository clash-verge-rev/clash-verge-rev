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
  getRuntimeConfig,
  getRuntimeProxyChainConfig,
  updateProxyAndSync,
  updateProxy,
} from "@/services/cmds";
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
  "proxy-groups"?: Array<{
    name: string;
    type: string;
    proxies?: string[];
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
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isChainConnected, setIsChainConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // 包装的更新链函数，用于从外部调用
  const wrappedOnUpdateChain = useCallback(
    (chain: ProxyChainItem[]) => {
      onUpdateChain(chain);
      setHasUnsavedChanges(true);
      onMarkUnsavedChanges?.();
    },
    [onUpdateChain, onMarkUnsavedChanges],
  );

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

  const handleToggleChain = useCallback(async () => {
    if (isChainConnected) {
      // Disconnect: clear chain config
      setIsConnecting(true);
      try {
        await updateProxyChainConfigInRuntime(null);
        setIsChainConnected(false);
        setHasUnsavedChanges(false);
      } catch (error) {
        console.error("Failed to disconnect chain:", error);
      } finally {
        setIsConnecting(false);
      }
    } else {
      // Connect: save chain config and update proxy
      setIsConnecting(true);
      try {
        if (proxyChain.length === 0) {
          // Save empty config (clear chain)
          await updateProxyChainConfigInRuntime(null);
        } else {
          // Check if chain has at least 2 nodes
          if (proxyChain.length < 2) {
            console.error("Chain proxy requires at least 2 nodes");
            alert(
              t("Chain proxy requires at least 2 nodes") ||
                "链式代理至少需要2个节点",
            );
            return;
          }

          // Get original proxy configurations from runtime
          const runtimeConfig = await getRuntimeConfig();

          if (!runtimeConfig || !(runtimeConfig as any).proxies) {
            console.error(
              "Failed to get runtime config or no proxies available",
            );
            return;
          }

          // Build chain configuration
          const chainProxies: any[] = [];

          // Process each node in the chain
          for (let i = 0; i < proxyChain.length; i++) {
            const currentNode = proxyChain[i];

            // Find original proxy configuration
            const proxies = (runtimeConfig as any).proxies;
            const originalProxy = Array.isArray(proxies)
              ? proxies.find((p: any) => p.name === currentNode.name)
              : null;

            if (!originalProxy) {
              console.warn(
                `Original proxy config not found for: ${currentNode.name}`,
              );
              continue;
            }
            chainProxies.push(currentNode.name);
          }
          setIsChainConnected(true);

          console.log("Saving chain config:", chainProxies);
          await updateProxyChainConfigInRuntime(chainProxies);

          if (proxyChain.length > 0) {
            await updateProxy(
              "proxy_chain",
              chainProxies[chainProxies.length - 1],
            );
          }
        }

        setHasUnsavedChanges(false);
      } catch (error) {
        console.error("Failed to connect chain:", error);
      } finally {
        setIsConnecting(false);
      }
    }
  }, [proxyChain, isChainConnected, t]);

  // 使用ref来存储最新的状态，避免useEffect依赖问题
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
              if (
                parsedConfig &&
                parsedConfig.proxies &&
                Array.isArray(parsedConfig.proxies)
              ) {
                const chainItems: ProxyChainItem[] = parsedConfig.proxies.map(
                  (proxy, index: number) => ({
                    id: `${proxy.name}_${Date.now()}_${index}`,
                    name: proxy.name,
                    type: proxy.type,
                    delay: undefined, // Will be updated by the delay update effect
                  }),
                );
                onUpdateChain(chainItems);
                setHasUnsavedChanges(false); // Reset unsaved changes when loading from config
              } else {
                // Empty or invalid config, reset chain
                onUpdateChain([]);
                setHasUnsavedChanges(false);
              }
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
              if (
                parsedConfig &&
                parsedConfig.proxies &&
                Array.isArray(parsedConfig.proxies)
              ) {
                const chainItems: ProxyChainItem[] = parsedConfig.proxies.map(
                  (proxy, index: number) => ({
                    id: `${proxy.name}_${Date.now()}_${index}`,
                    name: proxy.name,
                    type: proxy.type,
                    delay: undefined,
                  }),
                );
                onUpdateChain(chainItems);
                setHasUnsavedChanges(false);
              } else {
                onUpdateChain([]);
                setHasUnsavedChanges(false);
              }
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
            startIcon={<Save />}
            onClick={handleToggleChain}
            disabled={
              isConnecting ||
              (proxyChain.length > 0 &&
                proxyChain.length < 2 &&
                !isChainConnected)
            }
            color={isChainConnected ? "error" : "primary"}
            sx={{
              minWidth: 80,
            }}
            title={
              proxyChain.length === 1
                ? t("Chain proxy requires at least 2 nodes") ||
                  "链式代理至少需要2个节点"
                : undefined
            }
          >
            {isConnecting
              ? isChainConnected
                ? t("Disconnecting...") || "断开中..."
                : t("Connecting...") || "连接中..."
              : isChainConnected
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

      {proxyChain.length > 0 && (
        <Box
          sx={{ mt: 2, pt: 2, borderTop: `1px solid ${theme.palette.divider}` }}
        >
          <Typography variant="caption" color="text.secondary">
            {t("Proxy Order")}: {proxyChain.map((p) => p.name).join(" → ")}
          </Typography>
        </Box>
      )}
    </Paper>
  );
};
