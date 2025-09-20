import { Box, Snackbar, Alert } from "@mui/material";
import { useLockFn } from "ahooks";
import { useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { useProxySelection } from "@/hooks/use-proxy-selection";
import { useVerge } from "@/hooks/use-verge";
import { providerHealthCheck, getGroupProxyDelays } from "@/services/cmds";
import delayManager from "@/services/delay";

import { BaseEmpty } from "../base";
import { ScrollTopButton } from "../layout/scroll-top-button";

import { ProxyChain } from "./proxy-chain";
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

export const ProxyGroups = (props: Props) => {
  const { t } = useTranslation();
  const { mode, isChainMode = false, chainConfigData } = props;
  const [proxyChain, setProxyChain] = useState<ProxyChainItem[]>([]);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    open: boolean;
    message: string;
  }>({ open: false, message: "" });

  const { renderList, onProxies, onHeadState } = useRenderList(
    mode,
    isChainMode,
  );

  const { verge } = useVerge();

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

    try {
      const savedPositions = localStorage.getItem("proxy-scroll-positions");
      if (savedPositions) {
        const positions = JSON.parse(savedPositions);
        scrollPositionRef.current = positions;
        const savedPosition = positions[mode];

        if (savedPosition !== undefined) {
          setTimeout(() => {
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
  }, [mode, renderList]);

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
  const handleScroll = useCallback(
    throttle((e: any) => {
      const scrollTop = e.target.scrollTop;
      setShowScrollTop(scrollTop > 100);
      // 使用稳定的节流来保存位置，而不是setTimeout
      saveScrollPosition(scrollTop);
    }, 500), // 增加到500ms以确保平滑滚动
    [saveScrollPosition],
  );

  // 添加和清理滚动事件监听器
  useEffect(() => {
    const currentScroller = scrollerRef.current;
    if (currentScroller) {
      currentScroller.addEventListener("scroll", handleScroll, {
        passive: true,
      });
      return () => {
        currentScroller.removeEventListener("scroll", handleScroll);
      };
    }
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

  const handleChangeProxy = useCallback(
    (group: IProxyGroupItem, proxy: IProxyItem) => {
      if (isChainMode) {
        // 使用函数式更新来避免状态延迟问题
        setProxyChain((prev) => {
          // 检查是否已经存在相同名称的代理，防止重复添加
          if (prev.some((item) => item.name === proxy.name)) {
            const warningMessage = t("Proxy node already exists in chain");
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
    console.log(`[ProxyGroups] 开始测试所有延迟，组: ${groupName}`);

    const proxies = renderList
      .filter(
        (e) => e.group?.name === groupName && (e.type === 2 || e.type === 4),
      )
      .flatMap((e) => e.proxyCol || e.proxy!)
      .filter(Boolean);

    console.log(`[ProxyGroups] 找到代理数量: ${proxies.length}`);

    const providers = new Set(proxies.map((p) => p!.provider!).filter(Boolean));

    if (providers.size) {
      console.log(`[ProxyGroups] 发现提供者，数量: ${providers.size}`);
      Promise.allSettled(
        [...providers].map((p) => providerHealthCheck(p)),
      ).then(() => {
        console.log(`[ProxyGroups] 提供者健康检查完成`);
        onProxies();
      });
    }

    const names = proxies.filter((p) => !p!.provider).map((p) => p!.name);
    console.log(`[ProxyGroups] 过滤后需要测试的代理数量: ${names.length}`);

    const url = delayManager.getUrl(groupName);
    console.log(`[ProxyGroups] 测试URL: ${url}, 超时: ${timeout}ms`);

    try {
      await Promise.race([
        delayManager.checkListDelay(names, groupName, timeout),
        getGroupProxyDelays(groupName, url, timeout).then((result) => {
          console.log(
            `[ProxyGroups] getGroupProxyDelays返回结果数量:`,
            Object.keys(result || {}).length,
          );
        }), // 查询group delays 将清除fixed(不关注调用结果)
      ]);
      console.log(`[ProxyGroups] 延迟测试完成，组: ${groupName}`);
    } catch (error) {
      console.error(`[ProxyGroups] 延迟测试出错，组: ${groupName}`, error);
    }

    onProxies();
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

  if (mode === "direct") {
    return <BaseEmpty text={t("clash_mode_direct")} />;
  }

  if (isChainMode) {
    return (
      <>
        <Box sx={{ display: "flex", height: "100%", gap: 2 }}>
          <Box sx={{ flex: 1, position: "relative" }}>
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
                Footer: () => <div style={{ height: "8px" }} />,
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
      </>
    );
  }

  return (
    <div
      style={{ position: "relative", height: "100%", willChange: "transform" }}
    >
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
          Footer: () => <div style={{ height: "8px" }} />,
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
