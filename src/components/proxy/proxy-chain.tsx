import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Delete as DeleteIcon,
  DragIndicator,
  Link,
  LinkOff,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Typography,
  useTheme,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useSWR from "swr";
import {
  closeAllConnections,
  selectNodeForGroup,
} from "tauri-plugin-mihomo-api";

import { useProxiesData } from "@/hooks/use-clash-data";
import { calcuProxies, updateProxyChainConfigInRuntime } from "@/services/cmds";
import { debugLog } from "@/utils/debug";

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
  mode?: string;
  selectedGroup?: string | null;
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
          label={
            proxy.delay > 0
              ? `${proxy.delay}ms`
              : t("shared.labels.timeout") || "超时"
          }
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
  mode,
  selectedGroup,
}: ProxyChainProps) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { proxies } = useProxiesData();
  const [isConnecting, setIsConnecting] = useState(false);
  const markUnsavedChanges = useCallback(() => {
    onMarkUnsavedChanges?.();
  }, [onMarkUnsavedChanges]);

  // 获取当前代理信息以检查连接状态
  const { data: currentProxies, mutate: mutateProxies } = useSWR(
    "getProxies",
    calcuProxies,
    {
      revalidateOnFocus: true,
      revalidateIfStale: true,
      refreshInterval: 5000, // 每5秒刷新一次
    },
  );

  const isConnected = useMemo(() => {
    if (!currentProxies || proxyChain.length < 2) {
      return false;
    }

    const lastNode = proxyChain[proxyChain.length - 1];

    if (mode === "global") {
      return currentProxies.global?.now === lastNode.name;
    }

    if (!selectedGroup || !Array.isArray(currentProxies.groups)) {
      return false;
    }

    const proxyChainGroup = currentProxies.groups.find(
      (group) => group.name === selectedGroup,
    );

    return proxyChainGroup?.now === lastNode.name;
  }, [currentProxies, proxyChain, mode, selectedGroup]);

  // 监听链的变化，但排除从配置加载的情况
  const chainLengthRef = useRef(proxyChain.length);
  useEffect(() => {
    // 只有当链长度发生变化且不是初始加载时，才标记为未保存
    if (
      chainLengthRef.current !== proxyChain.length &&
      chainLengthRef.current !== 0
    ) {
      markUnsavedChanges();
    }
    chainLengthRef.current = proxyChain.length;
  }, [proxyChain.length, markUnsavedChanges]);

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
        markUnsavedChanges();
      }
    },
    [proxyChain, onUpdateChain, markUnsavedChanges],
  );

  const handleRemoveProxy = useCallback(
    (id: string) => {
      const newChain = proxyChain.filter((item) => item.id !== id);
      onUpdateChain(newChain);
      markUnsavedChanges();
    },
    [proxyChain, onUpdateChain, markUnsavedChanges],
  );

  const handleConnect = useCallback(async () => {
    if (isConnected) {
      setIsConnecting(true);
      try {
        await updateProxyChainConfigInRuntime(null);

        const targetGroup =
          mode === "global"
            ? "GLOBAL"
            : selectedGroup || localStorage.getItem("proxy-chain-group");

        if (targetGroup) {
          try {
            await selectNodeForGroup(targetGroup, "DIRECT");
          } catch {
            if (proxyChain.length >= 1) {
              try {
                await selectNodeForGroup(targetGroup, proxyChain[0].name);
              } catch {
                // ignore
              }
            }
          }
        }

        localStorage.removeItem("proxy-chain-group");
        localStorage.removeItem("proxy-chain-exit-node");
        localStorage.removeItem("proxy-chain-items");

        await closeAllConnections();
        await mutateProxies();

        onUpdateChain([]);
      } catch (error) {
        console.error("Failed to disconnect from proxy chain:", error);
        alert(t("proxies.page.chain.disconnectFailed") || "断开链式代理失败");
      } finally {
        setIsConnecting(false);
      }
      return;
    }

    if (proxyChain.length < 2) {
      alert(t("proxies.page.chain.minimumNodes") || "链式代理至少需要2个节点");
      return;
    }

    setIsConnecting(true);
    try {
      // 第一步：保存链式代理配置
      const chainProxies = proxyChain.map((node) => node.name);
      debugLog("Saving chain config:", chainProxies);
      await updateProxyChainConfigInRuntime(chainProxies);
      debugLog("Chain configuration saved successfully");

      // 第二步：连接到代理链的最后一个节点
      const lastNode = proxyChain[proxyChain.length - 1];
      debugLog(`Connecting to proxy chain, last node: ${lastNode.name}`);

      // 根据模式确定使用的代理组名称
      if (mode !== "global" && !selectedGroup) {
        throw new Error("规则模式下必须选择代理组");
      }

      const targetGroup = mode === "global" ? "GLOBAL" : selectedGroup;

      await selectNodeForGroup(targetGroup || "GLOBAL", lastNode.name);
      localStorage.setItem("proxy-chain-group", targetGroup || "GLOBAL");
      localStorage.setItem("proxy-chain-exit-node", lastNode.name);

      // 刷新代理信息以更新连接状态
      mutateProxies();
      debugLog("Successfully connected to proxy chain");
    } catch (error) {
      console.error("Failed to connect to proxy chain:", error);
      alert(t("proxies.page.chain.connectFailed") || "连接链式代理失败");
    } finally {
      setIsConnecting(false);
    }
  }, [
    proxyChain,
    isConnected,
    t,
    mutateProxies,
    mode,
    selectedGroup,
    onUpdateChain,
  ]);

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
              if (chainItems.length > 0) {
                onUpdateChain(chainItems);
              }
            } catch (parseError) {
              console.error("Failed to parse YAML:", parseError);
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
              if (chainItems.length > 0) {
                onUpdateChain(chainItems);
              }
            } catch (jsonError) {
              console.error("Failed to parse as JSON either:", jsonError);
            }
          });
      } catch (error) {
        console.error("Failed to process chain config data:", error);
      }
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
        <Typography variant="h6">{t("proxies.page.chain.header")}</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {proxyChain.length > 0 && (
            <IconButton
              size="small"
              onClick={() => {
                updateProxyChainConfigInRuntime(null);
                localStorage.removeItem("proxy-chain-group");
                localStorage.removeItem("proxy-chain-exit-node");
                localStorage.removeItem("proxy-chain-items");
                onUpdateChain([]);
              }}
              sx={{
                color: theme.palette.error.main,
                "&:hover": {
                  backgroundColor: theme.palette.error.light + "20",
                },
              }}
              title={
                t("proxies.page.actions.clearChainConfig") || "删除链式配置"
              }
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={isConnected ? <LinkOff /> : <Link />}
            onClick={handleConnect}
            disabled={
              isConnecting ||
              proxyChain.length < 2 ||
              (mode !== "global" && !selectedGroup)
            }
            color={isConnected ? "error" : "success"}
            sx={{
              minWidth: 90,
            }}
            title={
              proxyChain.length < 2
                ? t("proxies.page.chain.minimumNodes") ||
                  "链式代理至少需要2个节点"
                : undefined
            }
          >
            {isConnecting
              ? t("proxies.page.actions.connecting") || "连接中..."
              : isConnected
                ? t("proxies.page.actions.disconnect") || "断开"
                : t("proxies.page.actions.connect") || "连接"}
          </Button>
        </Box>
      </Box>

      <Alert
        severity={proxyChain.length === 1 ? "warning" : "info"}
        sx={{ mb: 2 }}
      >
        {proxyChain.length === 1
          ? t("proxies.page.chain.minimumNodesHint") ||
            "链式代理至少需要2个节点，请再添加一个节点。"
          : t("proxies.page.chain.instruction") ||
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
            <Typography>{t("proxies.page.chain.empty")}</Typography>
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
