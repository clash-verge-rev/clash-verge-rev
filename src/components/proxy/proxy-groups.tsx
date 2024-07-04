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
import { ChevronRight } from "@mui/icons-material";
import { Box, Link, List, ListItem } from "@mui/material";
import { useLockFn, useMemoizedFn } from "ahooks";
import { max, toArray } from "lodash-es";
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
  const timeout = verge?.default_latency_timeout || 10000;

  const virtuosoRef = useRef<VirtuosoHandle>(null);

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

  const sidebarWidth =
    max(
      renderList
        .filter((item) => item.type === 0)
        .flatMap((item) => {
          const width = toArray(item.key).length * 16;
          return width <= 200 ? width : 200;
        }),
    ) ?? 64;
  const [groupWidth, setGroupWidth] = useState(0);
  const open = groupWidth !== 0;

  return (
    <Box display={"flex"} flexDirection={"row"} width={"100%"} height={"100%"}>
      <Box position={"relative"}>
        <List
          dense
          sx={[
            ({ palette }) => ({
              bgcolor: palette.background.paper,
            }),
            {
              width: `${groupWidth}px`,
              height: "calc(100% - 20px)",
              marginLeft: open ? "5px" : 0,
              overflow: "auto",
              cursor: "pointer",
              transition: "all 0.2s",
              "&::-webkit-scrollbar": {
                width: "0px",
              },
            },
          ]}>
          {renderList
            .filter((item) => item.type === 0)
            .map((group) => (
              <ListItem
                key={group.key}
                sx={{ textAlign: "center", fontSize: "14px" }}>
                <Link
                  underline="hover"
                  onClick={() => handleGroupLocation(group.key)}>
                  {group.group.name}
                </Link>
              </ListItem>
            ))}
        </List>
      </Box>
      <Box
        flexGrow={1}
        height={"100%"}
        sx={{
          position: "relative",
        }}>
        <Box
          sx={{
            width: "20px",
            borderRadius: "0",
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 999,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}>
          <Box
            sx={[
              {
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              },
              ({ palette }) => ({
                "& .side-btn": {
                  opacity: open ? 1 : 0,
                  backgroundColor: open ? palette.primary.main : "transparent",
                },
                "&:hover .side-btn": {
                  opacity: 1,
                  backgroundColor: palette.primary.main,
                },
                "& .side-border": {
                  backgroundColor: open ? palette.primary.main : "transparent",
                },
                "&:hover .side-border": {
                  backgroundColor: palette.primary.main,
                },
              }),
            ]}>
            <div
              className="side-btn"
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "20px",
                height: "80px",
                padding: "0",
                transition: "all 0.2s",
                transform: "perspective(11px) rotateY(5deg)",
                cursor: "pointer",
              }}
              onClick={() => {
                setGroupWidth((prev) => (prev === 0 ? sidebarWidth : 0));
              }}>
              <ChevronRight
                sx={{
                  color: "white",
                  transform: open ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </div>
            <div
              className="side-border"
              style={{
                position: "absolute",
                width: 3,
                left: 0,
                top: 0,
                bottom: 0,
                zIndex: 999,
                transition: "all 0.2s",
              }}></div>
          </Box>
        </Box>
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: "calc(100% - 16px)" }}
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
