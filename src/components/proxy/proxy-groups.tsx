import { useRef } from "react";
import { useLockFn } from "ahooks";
import {
  Box,
  Divider,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import {
  ExpandLessRounded,
  ExpandMoreRounded,
  InboxRounded,
  SendRounded,
} from "@mui/icons-material";
import {
  getConnections,
  providerHealthCheck,
  updateProxy,
  deleteConnection,
} from "@/services/api";
import { useProfiles } from "@/hooks/use-profiles";
import { useVergeConfig } from "@/hooks/use-verge-config";
import { useRenderList, type IRenderItem } from "./use-render-list";
import { HeadState } from "./use-head-state";
import { ProxyHead } from "./proxy-head";
import { ProxyItem } from "./proxy-item";
import delayManager from "@/services/delay";

interface Props {
  mode: string;
}

export const ProxyGroups = (props: Props) => {
  const { mode } = props;

  const { renderList, onProxies, onHeadState } = useRenderList(mode);

  const { data: vergeConfig } = useVergeConfig();
  const { current, patchCurrent } = useProfiles();

  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // 切换分组的节点代理
  const handleChangeProxy = useLockFn(
    async (group: IProxyGroupItem, proxy: IProxyItem) => {
      if (group.type !== "Selector") return;

      const { name, now } = group;
      await updateProxy(name, proxy.name);
      onProxies();

      // 断开连接
      if (vergeConfig?.auto_close_connection) {
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
        (item) => item.name === group.name
      );

      if (index < 0) {
        current.selected.push({ name, now: proxy.name });
      } else {
        current.selected[index] = { name, now: proxy.name };
      }
      await patchCurrent({ selected: current.selected });
    }
  );

  // 测全部延迟
  const handleCheckAll = useLockFn(async (groupName: string) => {
    const proxies = renderList
      .filter((e) => e.type === 2 && e.group?.name === groupName)
      .map((e) => e.proxy!)
      .filter(Boolean);

    const providers = new Set(proxies.map((p) => p!.provider!).filter(Boolean));

    if (providers.size) {
      Promise.allSettled(
        [...providers].map((p) => providerHealthCheck(p))
      ).then(() => onProxies());
    }

    const names = proxies.filter((p) => !p!.provider).map((p) => p!.name);
    await delayManager.checkListDelay(names, groupName, 24);

    onProxies();
  });

  // 滚到对应的节点
  const handleLocation = (group: IProxyGroupItem) => {
    if (!group) return;
    const { name, now } = group;

    const index = renderList.findIndex(
      (e) => e.type === 2 && e.group?.name === name && e.proxy?.name === now
    );

    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex?.({
        index,
        align: "center",
        behavior: "smooth",
      });
    }
  };

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: "100%" }}
      totalCount={renderList.length}
      itemContent={(index) => (
        <ProxyRenderItem
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
  );
};

interface RenderProps {
  item: IRenderItem;
  indent: boolean;
  onLocation: (group: IProxyGroupItem) => void;
  onCheckAll: (groupName: string) => void;
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void;
  onChangeProxy: (group: IProxyGroupItem, proxy: IProxyItem) => void;
}

function ProxyRenderItem(props: RenderProps) {
  const { indent, item, onLocation, onCheckAll, onHeadState, onChangeProxy } =
    props;
  const { type, group, headState, proxy } = item;

  if (type === 0) {
    return (
      <ListItem
        button
        dense
        onClick={() => onHeadState(group.name, { open: !headState?.open })}
      >
        <ListItemText
          primary={group.name}
          secondary={
            <>
              <SendRounded color="primary" sx={{ mr: 1, fontSize: 14 }} />
              {/* <span>{group.type}</span> */}
              <span>{group.now}</span>
            </>
          }
          secondaryTypographyProps={{
            sx: { display: "flex", alignItems: "center" },
          }}
        />
        {headState?.open ? <ExpandLessRounded /> : <ExpandMoreRounded />}
      </ListItem>
    );
  }

  if (type === 1) {
    return (
      <ProxyHead
        sx={{ pl: indent ? 4.5 : 2.5, pr: 3, my: 1, button: { mr: 0.5 } }}
        groupName={group.name}
        headState={headState!}
        onLocation={() => onLocation(group)}
        onCheckDelay={() => onCheckAll(group.name)}
        onHeadState={(p) => onHeadState(group.name, p)}
      />
    );
  }

  if (type === 2) {
    return (
      <ProxyItem
        groupName={group.name}
        proxy={proxy!}
        selected={group.now === proxy?.name}
        showType={headState?.showType}
        sx={{ py: 0, pl: indent ? 4 : 2 }}
        onClick={() => onChangeProxy(group, proxy!)}
      />
    );
  }

  if (type === 3) {
    return (
      <Box
        sx={{
          py: 2,
          pl: indent ? 4.5 : 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <InboxRounded sx={{ fontSize: "2.5em", color: "inherit" }} />
        <Typography sx={{ color: "inherit" }}>No Proxies</Typography>
      </Box>
    );
  }

  return null;
}
