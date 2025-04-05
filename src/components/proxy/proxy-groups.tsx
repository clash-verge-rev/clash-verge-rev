import { ProxyGroupSidebar } from "@/components/proxy/proxy-group-sidebar";
import { ProxyRender } from "@/components/proxy/proxy-render";
import { useProfiles } from "@/hooks/use-profiles";
import { useVerge } from "@/hooks/use-verge";
import delayManager from "@/services/delay";
import { Box } from "@mui/material";
import { useLockFn, useMemoizedFn } from "ahooks";
import { useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  closeConnections,
  getConnections,
  healthcheckProxyProvider,
  selectNodeForProxy,
} from "tauri-plugin-mihomo-api";
import { BaseEmpty } from "../base";
import { useRenderList } from "./use-render-list";

interface Props {
  mode: string;
}

export const ProxyGroups = (props: Props) => {
  const { mode } = props;

  if (mode === "direct") {
    return <BaseEmpty text="Direct Mode" />;
  }

  const { renderList, onProxies, onHeadState } = useRenderList(mode);

  const { verge } = useVerge();
  const { current, patchCurrent } = useProfiles();
  const timeout = verge?.default_latency_timeout || 5000;

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // 切换分组的节点代理
  const handleChangeProxy = useMemoizedFn(
    useLockFn(async (group: IProxyGroupItem, proxy: IProxyItem) => {
      if (!["Selector", "URLTest", "Fallback"].includes(group.type)) return;

      const { name, now } = group;
      await selectNodeForProxy(name, proxy.name);
      onProxies();

      // 断开连接
      if (verge?.auto_close_connection) {
        getConnections().then(({ connections }) => {
          connections.forEach((conn) => {
            if (conn.chains.includes(now!)) {
              closeConnections(conn.id);
            }
          });
        });
      }

      // 保存到 selected 中
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
    }),
  );

  // 测全部延迟
  const handleCheckAll = useMemoizedFn(
    useLockFn(async (groupName: string) => {
      const proxies = renderList
        .filter(
          (e) => e.group?.name === groupName && (e.type === 2 || e.type === 4),
        )
        .flatMap((e) => e.proxyCol || e.proxy!)
        .filter(Boolean);

      const providers = new Set(
        proxies.map((p) => p!.provider!).filter(Boolean),
      );

      if (providers.size) {
        Promise.allSettled(
          [...providers].map((p) => healthcheckProxyProvider(p)),
        ).then(() => onProxies());
      }
      const names = proxies.filter((p) => !p!.provider).map((p) => p!.name);
      await delayManager.checkListDelay(names, groupName, timeout);

      onProxies();
    }),
  );

  // 滚到对应的节点
  const handleGroupLocation = useMemoizedFn((groupName: string) => {
    if (!groupName) return;

    const index = renderList.findIndex(
      (e) => e.type === 0 && e.key === groupName,
    );

    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex?.({
        index,
        align: "start",
        behavior: "auto",
      });
    }
  });

  // 滚到对应的节点
  const handleLocation = useMemoizedFn((group: IProxyGroupItem) => {
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
  });

  const groupNameList = renderList
    .filter((item) => item.type === 0)
    .map((item) => item.key);

  return (
    <Box className="relative flex h-full w-full">
      <Box className="h-full w-full pr-7">
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: "calc(100% - 8px)" }}
          totalCount={renderList.length}
          increaseViewportBy={256}
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
      </Box>

      <div className="absolute top-0 right-0 bottom-0 z-10 mr-0 w-7 bg-transparent hover:w-[120px]">
        <div className="flex h-full w-full items-center justify-center hover:shadow-2xl">
          <ProxyGroupSidebar
            groupNameList={groupNameList}
            onGroupNameClick={(groupName) => {
              handleGroupLocation(groupName);
            }}
          />
        </div>
      </div>
    </Box>
  );
};
