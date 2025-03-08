import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useLockFn } from "ahooks";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  getConnections,
  providerHealthCheck,
  updateProxy,
  deleteConnection,
  getGroupProxyDelays,
} from "@/services/api";
import { useProfiles } from "@/hooks/use-profiles";
import { useVerge } from "@/hooks/use-verge";
import { BaseEmpty } from "../base";
import { useRenderList } from "./use-render-list";
import { ProxyRender } from "./proxy-render";
import delayManager from "@/services/delay";
import { useTranslation } from "react-i18next";
import { ScrollTopButton } from "../layout/scroll-top-button";
import { Box, styled } from "@mui/material";
import { memo } from "react";
import { createPortal } from "react-dom";

// 将选择器组件抽离出来，避免主组件重渲染时重复创建样式
const AlphabetSelector = styled(Box)(({ theme }) => ({
  position: "fixed",
  right: 4,
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  flexDirection: "column",
  background: "transparent",
  zIndex: 1000,
  gap: "2px",
  // padding: "4px 2px",
  willChange: "transform",
  "&:hover": {
    background: theme.palette.background.paper,
    boxShadow: theme.shadows[2],
    borderRadius: "8px",
  },
  "& .scroll-container": {
    overflow: "hidden",
    maxHeight: "inherit",
    willChange: "transform",
  },
  "& .letter-container": {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    transition: "transform 0.2s ease",
    willChange: "transform",
  },
  "& .letter": {
    padding: "1px 4px",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    color: theme.palette.text.secondary,
    position: "relative",
    width: "1.5em",
    height: "1.5em",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
    transform: "scale(1) translateZ(0)",
    backfaceVisibility: "hidden",
    borderRadius: "6px",
    "&:hover": {
      color: theme.palette.primary.main,
      transform: "scale(1.4) translateZ(0)",
      backgroundColor: theme.palette.action.hover,
    },
  },
}));

// 创建一个单独的 Tooltip 组件
const Tooltip = styled("div")(({ theme }) => ({
  position: "fixed",
  background: theme.palette.background.paper,
  padding: "4px 8px",
  borderRadius: "6px",
  boxShadow: theme.shadows[3],
  whiteSpace: "nowrap",
  fontSize: "16px",
  color: theme.palette.text.primary,
  pointerEvents: "none",
  "&::after": {
    content: '""',
    position: "absolute",
    right: "-4px",
    top: "50%",
    transform: "translateY(-50%)",
    width: 0,
    height: 0,
    borderTop: "4px solid transparent",
    borderBottom: "4px solid transparent",
    borderLeft: `4px solid ${theme.palette.background.paper}`,
  },
}));

// 抽离字母选择器子组件
const LetterItem = memo(
  ({
    name,
    onClick,
    getFirstChar,
  }: {
    name: string;
    onClick: (name: string) => void;
    getFirstChar: (str: string) => string;
  }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const letterRef = useRef<HTMLDivElement>(null);
    const [tooltipPosition, setTooltipPosition] = useState({
      top: 0,
      right: 0,
    });
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

    const updateTooltipPosition = useCallback(() => {
      if (!letterRef.current) return;
      const rect = letterRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.top + rect.height / 2,
        right: window.innerWidth - rect.left + 8,
      });
    }, []);

    useEffect(() => {
      if (showTooltip) {
        updateTooltipPosition();
      }
    }, [showTooltip, updateTooltipPosition]);

    const handleMouseEnter = useCallback(() => {
      setShowTooltip(true);
      // 添加 200ms 的延迟，避免鼠标快速划过时触发滚动
      hoverTimeoutRef.current = setTimeout(() => {
        onClick(name);
      }, 100);
    }, [name, onClick]);

    const handleMouseLeave = useCallback(() => {
      setShowTooltip(false);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    }, []);

    useEffect(() => {
      return () => {
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
        }
      };
    }, []);

    return (
      <>
        <div
          ref={letterRef}
          className="letter"
          onClick={() => onClick(name)}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span>{getFirstChar(name)}</span>
        </div>
        {showTooltip &&
          createPortal(
            <Tooltip
              style={{
                top: tooltipPosition.top,
                right: tooltipPosition.right,
                transform: "translateY(-50%)",
              }}
            >
              {name}
            </Tooltip>,
            document.body,
          )}
      </>
    );
  },
);

interface Props {
  mode: string;
}

export const ProxyGroups = (props: Props) => {
  const { t } = useTranslation();
  const { mode } = props;

  const { renderList, onProxies, onHeadState } = useRenderList(mode);

  const { verge } = useVerge();
  const { current, patchCurrent } = useProfiles();
  const timeout = verge?.default_latency_timeout || 10000;

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollPositionRef = useRef<Record<string, number>>({});
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollerRef = useRef<Element | null>(null);
  const letterContainerRef = useRef<HTMLDivElement>(null);
  const alphabetSelectorRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState("auto");

  // 使用useMemo缓存字母索引数据
  const { groupFirstLetters, letterIndexMap } = useMemo(() => {
    const letters = new Set<string>();
    const indexMap: Record<string, number> = {};

    renderList.forEach((item, index) => {
      if (item.type === 0) {
        const fullName = item.group.name;
        letters.add(fullName);
        if (!(fullName in indexMap)) {
          indexMap[fullName] = index;
        }
      }
    });

    return {
      groupFirstLetters: Array.from(letters),
      letterIndexMap: indexMap,
    };
  }, [renderList]);

  // 缓存getFirstChar函数
  const getFirstChar = useCallback((str: string) => {
    const regex =
      /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}|\p{L}|\p{N}|./u;
    const match = str.match(regex);
    return match ? match[0] : str.charAt(0);
  }, []);

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

  // 处理字母点击，使用useCallback
  const handleLetterClick = useCallback(
    (name: string) => {
      const index = letterIndexMap[name];
      if (index !== undefined) {
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "start",
          behavior: "smooth",
        });
      }
    },
    [letterIndexMap],
  );

  // 切换分组的节点代理
  const handleChangeProxy = useLockFn(
    async (group: IProxyGroupItem, proxy: IProxyItem) => {
      if (!["Selector", "URLTest", "Fallback"].includes(group.type)) return;

      const { name, now } = group;
      await updateProxy(name, proxy.name);
      onProxies();

      // 断开连接
      if (verge?.auto_close_connection) {
        getConnections().then(({ connections }) => {
          connections.forEach((conn) => {
            if (conn.chains.includes(now!)) {
              deleteConnection(conn.id);
            }
          });
        });
      }

      // 保存到selected中
      if (!current) return;
      if (!current.selected) current.selected = [];

      const index = current.selected.findIndex(
        (item) => item.name === group.name,
      );

      if (index < 0) {
        current.selected.push({ name, now: proxy.name });
      } else {
        current.selected[index] = { name, now: proxy.name };
      }
      await patchCurrent({ selected: current.selected });
    },
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

  // 添加滚轮事件处理函数 - 改进为只在悬停时触发
  const handleWheel = useCallback((e: WheelEvent) => {
    // 只有当鼠标在字母选择器上时才处理滚轮事件
    if (!alphabetSelectorRef.current?.contains(e.target as Node)) return;

    e.preventDefault();
    if (!letterContainerRef.current) return;

    const container = letterContainerRef.current;
    const scrollAmount = e.deltaY;
    const currentTransform = new WebKitCSSMatrix(container.style.transform);
    const currentY = currentTransform.m42 || 0;

    const containerHeight = container.getBoundingClientRect().height;
    const parentHeight =
      container.parentElement?.getBoundingClientRect().height || 0;
    const maxScroll = Math.max(0, containerHeight - parentHeight);

    let newY = currentY - scrollAmount;
    newY = Math.min(0, Math.max(-maxScroll, newY));

    container.style.transform = `translateY(${newY}px)`;
  }, []);

  // 添加和移除滚轮事件监听
  useEffect(() => {
    const container = letterContainerRef.current?.parentElement;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false });
      return () => {
        container.removeEventListener("wheel", handleWheel);
      };
    }
  }, [handleWheel]);

  // 添加窗口大小变化监听和最大高度计算
  const updateMaxHeight = useCallback(() => {
    if (!alphabetSelectorRef.current) return;

    const windowHeight = window.innerHeight;
    const bottomMargin = 60; // 底部边距
    const topMargin = bottomMargin * 2; // 顶部边距是底部的2倍
    const availableHeight = windowHeight - (topMargin + bottomMargin);

    // 调整选择器的位置，使其偏下
    const offsetPercentage =
      (((topMargin - bottomMargin) / windowHeight) * 100) / 2;
    alphabetSelectorRef.current.style.top = `calc(48% + ${offsetPercentage}vh)`;

    setMaxHeight(`${availableHeight}px`);
  }, []);

  // 监听窗口大小变化
  useEffect(() => {
    updateMaxHeight();
    window.addEventListener("resize", updateMaxHeight);
    return () => {
      window.removeEventListener("resize", updateMaxHeight);
    };
  }, [updateMaxHeight]);

  if (mode === "direct") {
    return <BaseEmpty text={t("clash_mode_direct")} />;
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

      <AlphabetSelector ref={alphabetSelectorRef} style={{ maxHeight }}>
        <div className="scroll-container">
          <div ref={letterContainerRef} className="letter-container">
            {groupFirstLetters.map((name) => (
              <LetterItem
                key={name}
                name={name}
                onClick={handleLetterClick}
                getFirstChar={getFirstChar}
              />
            ))}
          </div>
        </div>
      </AlphabetSelector>
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

// 保留防抖函数以兼容其他地方可能的使用
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
