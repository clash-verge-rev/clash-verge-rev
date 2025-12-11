import { ExpandMoreRounded } from "@mui/icons-material";
import {
  Alert,
  Box,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Snackbar,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { delayGroup, healthcheckProxyProvider } from "tauri-plugin-mihomo-api";

import { useProxiesData } from "@/hooks/use-clash-data";
import { useProxySelection } from "@/hooks/use-proxy-selection";
import { useVerge } from "@/hooks/use-verge";
import { updateProxyChainConfigInRuntime } from "@/services/cmds";
import delayManager from "@/services/delay";
import { debugLog } from "@/utils/debug";

import { BaseEmpty } from "../base";
import { ScrollTopButton } from "../layout/scroll-top-button";

import { ProxyChain } from "./proxy-chain";
import {
  DEFAULT_HOVER_DELAY,
  ProxyGroupNavigator,
} from "./proxy-group-navigator";
import { ProxyRender } from "./proxy-render";
import { useRenderList } from "./use-render-list";

interface Props {
  mode: string;
  isChainMode?: boolean;
  chainConfigData?: string | null;
}

interface ProxyChainItem {
  id: string;
  name: string;
  type?: string;
  delay?: number;
}

const VirtuosoFooter = () => <div style={{ height: "8px" }} />;

export const ProxyGroups = (props: Props) => {
  const { t } = useTranslation();
  const { mode, isChainMode = false, chainConfigData } = props;
  const [proxyChain, setProxyChain] = useState<ProxyChainItem[]>(() => {
    try {
      const saved = localStorage.getItem("proxy-chain-items");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  useEffect(() => {
    if (proxyChain.length > 0) {
      localStorage.setItem("proxy-chain-items", JSON.stringify(proxyChain));
    } else {
      localStorage.removeItem("proxy-chain-items");
    }
  }, [proxyChain]);
  const [ruleMenuAnchor, setRuleMenuAnchor] = useState<null | HTMLElement>(
    null,
  );
  const [duplicateWarning, setDuplicateWarning] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });

  const { verge } = useVerge();
  const { proxies: proxiesData } = useProxiesData();
  const groups = proxiesData?.groups;
  const availableGroups = useMemo(() => {
    if (!groups) return [];
    // 在链式代理模式下，仅显示支持选择节点的 Selector 代理组
    return isChainMode
      ? groups.filter((g: any) => g.type === "Selector")
      : groups;
  }, [groups, isChainMode]);

  const defaultRuleGroup = useMemo(() => {
    if (isChainMode && mode === "rule" && availableGroups.length > 0) {
      return availableGroups[0].name;
    }
    return null;
  }, [availableGroups, isChainMode, mode]);

  const activeSelectedGroup = useMemo(
    () => selectedGroup ?? defaultRuleGroup,
    [selectedGroup, defaultRuleGroup],
  );

  const { renderList, onProxies, onHeadState } = useRenderList(
    mode,
    isChainMode,
    activeSelectedGroup,
  );

  const getGroupHeadState = useCallback(
    (groupName: string) => {
      const headItem = renderList.find(
        (item) => item.type === 1 && item.group?.name === groupName,
      );
      return headItem?.headState;
    },
    [renderList],
  );

  // 统代理选择
  const { handleProxyGroupChange } = useProxySelection({
    onSuccess: () => {
      onProxies();
    },
    onError: (error) => {
      console.error("代理切换失败", error);
      onProxies();
    },
  });

  const timeout = verge?.default_latency_timeout || 10000;

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollPositionRef = useRef<Record<string, number>>({});
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollerRef = useRef<Element | null>(null);

  // 从 localStorage 恢复滚动位置
  useEffect(() => {
    if (renderList.length === 0) return;

    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const savedPositions = localStorage.getItem("proxy-scroll-positions");
      if (savedPositions) {
        const positions = JSON.parse(savedPositions);
        scrollPositionRef.current = positions;
        const savedPosition = positions[mode];

        if (savedPosition !== undefined) {
          restoreTimer = setTimeout(() => {
            virtuosoRef.current?.scrollTo({
              top: savedPosition,
              behavior: "auto",
            });
          }, 100);
        }
      }
    } catch (e) {
      console.error("Error restoring scroll position:", e);
    }

    return () => {
      if (restoreTimer) {
        clearTimeout(restoreTimer);
      }
    };
  }, [mode, renderList.length]);

  // 改为使用节流函数保存滚动位置
  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      try {
        scrollPositionRef.current[mode] = scrollTop;
        localStorage.setItem(
          "proxy-scroll-positions",
          JSON.stringify(scrollPositionRef.current),
        );
      } catch (e) {
        console.error("Error saving scroll position:", e);
      }
    },
    [mode],
  );

  // 使用改进的滚动处理
  const handleScroll = useMemo(
    () =>
      throttle((event: Event) => {
        const target = event.target as HTMLElement | null;
        const scrollTop = target?.scrollTop ?? 0;
        setShowScrollTop(scrollTop > 100);
        // 使用稳定的节流来保存位置，而不是setTimeout
        saveScrollPosition(scrollTop);
      }, 500), // 增加到500ms以确保平滑滚动
    [saveScrollPosition],
  );

  // 添加和清理滚动事件监听器
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;

    const listener = handleScroll as EventListener;
    const options: AddEventListenerOptions = { passive: true };

    node.addEventListener("scroll", listener, options);

    return () => {
      node.removeEventListener("scroll", listener, options);
    };
  }, [handleScroll]);

  // 滚动到顶部
  const scrollToTop = useCallback(() => {
    virtuosoRef.current?.scrollTo?.({
      top: 0,
      behavior: "smooth",
    });
    saveScrollPosition(0);
  }, [saveScrollPosition]);

  // 关闭重复节点警告
  const handleCloseDuplicateWarning = useCallback(() => {
    setDuplicateWarning({ open: false, message: "" });
  }, []);

  const currentGroup = useMemo(() => {
    if (!activeSelectedGroup) return null;
    return (
      availableGroups.find(
        (group: any) => group.name === activeSelectedGroup,
      ) ?? null
    );
  }, [activeSelectedGroup, availableGroups]);

  // 处理代理组选择菜单
  const handleGroupMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setRuleMenuAnchor(event.currentTarget);
  };

  const handleGroupMenuClose = () => {
    setRuleMenuAnchor(null);
  };

  const handleGroupSelect = (groupName: string) => {
    setSelectedGroup(groupName);
    handleGroupMenuClose();

    if (isChainMode && mode === "rule") {
      updateProxyChainConfigInRuntime(null);
      localStorage.removeItem("proxy-chain-group");
      localStorage.removeItem("proxy-chain-exit-node");
      localStorage.removeItem("proxy-chain-items");
      setProxyChain([]);
    }
  };

  const handleChangeProxy = useCallback(
    (group: IProxyGroupItem, proxy: IProxyItem) => {
      if (isChainMode) {
        // 使用函数式更新来避免状态延迟问题
        setProxyChain((prev) => {
          // 检查是否已经存在相同名称的代理，防止重复添加
          if (prev.some((item) => item.name === proxy.name)) {
            const warningMessage = t("proxies.page.chain.duplicateNode");
            setDuplicateWarning({
              open: true,
              message: warningMessage,
            });
            return prev; // 返回原来的状态，不做任何更改
          }

          // 安全获取延迟数据，如果没有延迟数据则设为 undefined
          const delay =
            proxy.history && proxy.history.length > 0
              ? proxy.history[proxy.history.length - 1].delay
              : undefined;

          const chainItem: ProxyChainItem = {
            id: `${proxy.name}_${Date.now()}`,
            name: proxy.name,
            type: proxy.type,
            delay: delay,
          };

          return [...prev, chainItem];
        });
        return;
      }

      if (!["Selector", "URLTest", "Fallback"].includes(group.type)) return;

      handleProxyGroupChange(group, proxy);
    },
    [handleProxyGroupChange, isChainMode, t],
  );

  // 测全部延迟
  const handleCheckAll = useLockFn(async (groupName: string) => {
    debugLog(`[ProxyGroups] 开始测试所有延迟，组: ${groupName}`);

    const proxies = renderList
      .filter(
        (e) => e.group?.name === groupName && (e.type === 2 || e.type === 4),
      )
      .flatMap((e) => e.proxyCol || e.proxy!)
      .filter(Boolean);

    debugLog(`[ProxyGroups] 找到代理数量: ${proxies.length}`);

    const providers = new Set(proxies.map((p) => p!.provider!).filter(Boolean));

    if (providers.size) {
      debugLog(`[ProxyGroups] 发现提供者，数量: ${providers.size}`);
      Promise.allSettled(
        [...providers].map((p) => healthcheckProxyProvider(p)),
      ).then(() => {
        debugLog(`[ProxyGroups] 提供者健康检查完成`);
        onProxies();
      });
    }

    const names = proxies.filter((p) => !p!.provider).map((p) => p!.name);
    debugLog(`[ProxyGroups] 过滤后需要测试的代理数量: ${names.length}`);

    const url = delayManager.getUrl(groupName);
    debugLog(`[ProxyGroups] 测试URL: ${url}, 超时: ${timeout}ms`);

    try {
      await Promise.race([
        delayManager.checkListDelay(names, groupName, timeout),
        delayGroup(groupName, url, timeout).then((result) => {
          debugLog(
            `[ProxyGroups] getGroupProxyDelays返回结果数量:`,
            Object.keys(result || {}).length,
          );
        }), // 查询group delays 将清除fixed(不关注调用结果)
      ]);
      debugLog(`[ProxyGroups] 延迟测试完成，组: ${groupName}`);
    } catch (error) {
      console.error(`[ProxyGroups] 延迟测试出错，组: ${groupName}`, error);
    } finally {
      const headState = getGroupHeadState(groupName);
      if (headState?.sortType === 1) {
        onHeadState(groupName, { sortType: headState.sortType });
      }
      onProxies();
    }
  });

  // 滚到对应的节点
  const handleLocation = (group: IProxyGroupItem) => {
    if (!group) return;
    const { name, now } = group;

    const index = renderList.findIndex(
      (e) =>
        e.group?.name === name &&
        ((e.type === 2 && e.proxy?.name === now) ||
          (e.type === 4 && e.proxyCol?.some((p) => p.name === now))),
    );

    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex?.({
        index,
        align: "center",
        behavior: "smooth",
      });
    }
  };

  // 定位到指定的代理组
  const handleGroupLocationByName = useCallback(
    (groupName: string) => {
      const index = renderList.findIndex(
        (item) => item.type === 0 && item.group?.name === groupName,
      );

      if (index >= 0) {
        virtuosoRef.current?.scrollToIndex?.({
          index,
          align: "start",
          behavior: "smooth",
        });
      }
    },
    [renderList],
  );

  const proxyGroupNames = useMemo(() => {
    const names = renderList
      .filter((item) => item.type === 0 && item.group?.name)
      .map((item) => item.group!.name);
    return Array.from(new Set(names));
  }, [renderList]);

  if (mode === "direct") {
    return <BaseEmpty textKey="proxies.page.messages.directMode" />;
  }

  if (isChainMode) {
    // 获取所有代理组
    const proxyGroups = proxiesData?.groups || [];

    return (
      <>
        <Box sx={{ display: "flex", height: "100%", gap: 2 }}>
          <Box sx={{ flex: 1, position: "relative" }}>
            {/* 代理规则标题和代理组按钮栏 */}
            {mode === "rule" && proxyGroups.length > 0 && (
              <Box sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
                {/* 代理规则标题 */}
                <Box
                  sx={{
                    px: 2,
                    py: 1.5,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 600, fontSize: "16px" }}
                    >
                      {t("proxies.page.rules.title")}
                    </Typography>
                    {currentGroup && (
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Chip
                          size="small"
                          label={`${currentGroup.name} (${currentGroup.type})`}
                          variant="outlined"
                          sx={{
                            fontSize: "12px",
                            maxWidth: "200px",
                            "& .MuiChip-label": {
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            },
                          }}
                        />
                      </Box>
                    )}
                  </Box>

                  {availableGroups.length > 0 && (
                    <IconButton
                      size="small"
                      onClick={handleGroupMenuOpen}
                      sx={{
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: "4px",
                        padding: "4px 8px",
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{ mr: 0.5, fontSize: "12px" }}
                      >
                        {t("proxies.page.rules.select")}
                      </Typography>
                      <ExpandMoreRounded fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              </Box>
            )}

            <Virtuoso
              ref={virtuosoRef}
              style={{
                height:
                  mode === "rule" && proxyGroups.length > 0
                    ? "calc(100% - 80px)" // 只有标题的高度
                    : "calc(100% - 14px)",
              }}
              totalCount={renderList.length}
              increaseViewportBy={{ top: 200, bottom: 200 }}
              overscan={150}
              defaultItemHeight={56}
              scrollerRef={(ref) => {
                scrollerRef.current = ref as Element;
              }}
              components={{
                Footer: VirtuosoFooter,
              }}
              initialScrollTop={scrollPositionRef.current[mode]}
              computeItemKey={(index) => renderList[index].key}
              itemContent={(index) => (
                <ProxyRender
                  key={renderList[index].key}
                  item={renderList[index]}
                  indent={mode === "rule" || mode === "script"}
                  onLocation={handleLocation}
                  onCheckAll={handleCheckAll}
                  onHeadState={onHeadState}
                  onChangeProxy={handleChangeProxy}
                  isChainMode={isChainMode}
                />
              )}
            />
            <ScrollTopButton show={showScrollTop} onClick={scrollToTop} />
          </Box>

          <Box sx={{ width: "400px", minWidth: "300px" }}>
            <ProxyChain
              proxyChain={proxyChain}
              onUpdateChain={setProxyChain}
              chainConfigData={chainConfigData}
              mode={mode}
              selectedGroup={activeSelectedGroup}
            />
          </Box>
        </Box>

        <Snackbar
          open={duplicateWarning.open}
          autoHideDuration={3000}
          onClose={handleCloseDuplicateWarning}
          anchorOrigin={{ vertical: "top", horizontal: "center" }}
        >
          <Alert
            onClose={handleCloseDuplicateWarning}
            severity="warning"
            variant="filled"
          >
            {duplicateWarning.message}
          </Alert>
        </Snackbar>

        {/* 代理组选择菜单 */}
        <Menu
          anchorEl={ruleMenuAnchor}
          open={Boolean(ruleMenuAnchor)}
          onClose={handleGroupMenuClose}
          slotProps={{
            paper: {
              sx: {
                maxHeight: 300,
                minWidth: 200,
              },
            },
          }}
        >
          {availableGroups.map((group: any) => (
            <MenuItem
              key={group.name}
              onClick={() => handleGroupSelect(group.name)}
              selected={activeSelectedGroup === group.name}
              sx={{
                fontSize: "14px",
                py: 1,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {group.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {group.type} · {group.all.length} 节点
                </Typography>
              </Box>
            </MenuItem>
          ))}
          {availableGroups.length === 0 && (
            <MenuItem disabled>
              <Typography variant="body2" color="text.secondary">
                暂无可用代理组
              </Typography>
            </MenuItem>
          )}
        </Menu>
      </>
    );
  }

  return (
    <div
      style={{ position: "relative", height: "100%", willChange: "transform" }}
    >
      {/* 代理组导航栏 */}
      {mode === "rule" && (
        <ProxyGroupNavigator
          proxyGroupNames={proxyGroupNames}
          onGroupLocation={handleGroupLocationByName}
          enableHoverJump={verge?.enable_hover_jump_navigator ?? true}
          hoverDelay={verge?.hover_jump_navigator_delay ?? DEFAULT_HOVER_DELAY}
        />
      )}

      <Virtuoso
        ref={virtuosoRef}
        style={{ height: "calc(100% - 14px)" }}
        totalCount={renderList.length}
        increaseViewportBy={{ top: 200, bottom: 200 }}
        overscan={150}
        defaultItemHeight={56}
        scrollerRef={(ref) => {
          scrollerRef.current = ref as Element;
        }}
        components={{
          Footer: VirtuosoFooter,
        }}
        // 添加平滑滚动设置
        initialScrollTop={scrollPositionRef.current[mode]}
        computeItemKey={(index) => renderList[index].key}
        itemContent={(index) => (
          <ProxyRender
            key={renderList[index].key}
            item={renderList[index]}
            indent={mode === "rule" || mode === "script"}
            onLocation={handleLocation}
            onCheckAll={handleCheckAll}
            onHeadState={onHeadState}
            onChangeProxy={handleChangeProxy}
          />
        )}
      />
      <ScrollTopButton show={showScrollTop} onClick={scrollToTop} />
    </div>
  );
};

// 替换简单防抖函数为更优的节流函数
function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let previous = 0;

  return function (...args: Parameters<T>) {
    const now = Date.now();
    const remaining = wait - (now - previous);

    if (remaining <= 0 || remaining > wait) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      previous = now;
      func(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        previous = Date.now();
        timer = null;
        func(...args);
      }, remaining);
    }
  };
}
