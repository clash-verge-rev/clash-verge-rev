import { ProxyGroupSidebar } from "@/components/proxy/proxy-group-sidebar";
import { ProxyRender } from "@/components/proxy/proxy-render";
import { useProfiles } from "@/hooks/use-profiles";
import { useVerge } from "@/hooks/use-verge";
import {
  deleteConnection,
  getConnections,
  getGroupProxyDelays,
  providerHealthCheck,
  updateProxy,
} from "@/services/api";
import delayManager from "@/services/delay";
import { cn } from "@/utils";
import { ChevronRight } from "@mui/icons-material";
import { Box } from "@mui/material";
import { useLockFn, useMemoizedFn } from "ahooks";
import { useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
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

  const [open, setOpen] = useState(false);

  // 切换分组的节点代理
  const handleChangeProxy = useMemoizedFn(
    useLockFn(async (group: IProxyGroupItem, proxy: IProxyItem) => {
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
          [...providers].map((p) => providerHealthCheck(p)),
        ).then(() => onProxies());
      }

      const names = proxies.filter((p) => !p!.provider).map((p) => p!.name);

      await Promise.race([
        delayManager.checkListDelay(names, groupName, timeout),
        getGroupProxyDelays(groupName, delayManager.getUrl(groupName), timeout), // 查询group delays 将清除fixed(不关注调用结果)
      ]);

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
      <div
        className={cn("absolute bottom-0 left-0 top-0 z-10 w-6", {
          "w-fit": open,
        })}>
        <div
          className={cn("relative flex h-full w-full")}
          onMouseLeave={() => {
            setOpen(false);
          }}>
          <ProxyGroupSidebar
            className={cn("w-0 max-w-[200px] p-0 transition-all duration-200", {
              "w-fit px-2 py-4": open,
            })}
            groupNameList={groupNameList}
            onClickGroupName={(groupName) => {
              handleGroupLocation(groupName);
              setOpen(false);
            }}
          />
          <div className="relative flex w-fit items-center bg-transparent">
            <div
              className={cn(
                "peer flex h-16 w-5 cursor-pointer items-center justify-center bg-primary p-0 opacity-0 transition-all duration-200 hover:opacity-100",
                {
                  "opacity-100": open,
                },
              )}
              onClick={() => {
                setOpen((pre) => !pre);
              }}>
              <ChevronRight
                sx={{
                  color: "white",
                  transform: open ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              />
            </div>
            <div
              className={cn(
                "absolute bottom-0 left-0 top-0 z-10 w-1 transition-all duration-200 peer-hover:bg-primary",
                {
                  "bg-primary": open,
                },
              )}></div>
          </div>
        </div>
      </div>
      <Box className="h-full w-full">
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
    </Box>
  );
};
