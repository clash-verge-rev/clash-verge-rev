import { useRef, useState, useEffect } from "react";
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

  const [showScrollTop, setShowScrollTop] = useState(false);

  // 添加滚动处理函数
  const handleScroll = (e: any) => {
    const scrollTop = e.target.scrollTop;
    setShowScrollTop(scrollTop > 100);
  };

  // 滚动到顶部
  const scrollToTop = () => {
    virtuosoRef.current?.scrollTo?.({
      top: 0,
      behavior: "smooth",
    });
  };

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
    const proxies = renderList
      .filter(
        (e) => e.group?.name === groupName && (e.type === 2 || e.type === 4),
      )
      .flatMap((e) => e.proxyCol || e.proxy!)
      .filter(Boolean);

    const providers = new Set(proxies.map((p) => p!.provider!).filter(Boolean));

    if (providers.size) {
      Promise.allSettled(
        [...providers].map((p) => providerHealthCheck(p)),
      ).then(() => onProxies());
    }

    const names = proxies.filter((p) => !p!.provider).map((p) => p!.name);

    await Promise.race([
      delayManager.checkListDelay(names, groupName, timeout),
      getGroupProxyDelays(groupName, delayManager.getUrl(groupName), timeout), // 查询group delays 将清除fixed(不关注调用结果)
    ]);

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

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: "calc(100% - 16px)" }}
        totalCount={renderList.length}
        increaseViewportBy={256}
        scrollerRef={(ref) => {
          if (ref) {
            ref.addEventListener("scroll", handleScroll);
          }
        }}
        itemContent={(index) => (
          <>
            <ProxyRender
              key={renderList[index].key}
              item={renderList[index]}
              indent={mode === "rule" || mode === "script"}
              onLocation={handleLocation}
              onCheckAll={handleCheckAll}
              onHeadState={onHeadState}
              onChangeProxy={handleChangeProxy}
            />
          </>
        )}
      />

      <ScrollTopButton show={showScrollTop} onClick={scrollToTop} />
    </div>
  );
};
