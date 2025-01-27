import { useVerge } from "@/hooks/use-verge";
import { downloadIconCache } from "@/services/cmds";
import {
  ExpandLessRounded,
  ExpandMoreRounded,
  InboxRounded,
} from "@mui/icons-material";
import {
  alpha,
  Box,
  ListItemButton,
  ListItemText,
  styled,
  Typography,
} from "@mui/material";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemoizedFn } from "ahooks";
import { memo, useEffect, useState } from "react";
import { ProxyHead } from "./proxy-head";
import { ProxyItem } from "./proxy-item";
import { ProxyItemMini } from "./proxy-item-mini";
import { HeadState } from "./use-head-state";
import type { IRenderItem } from "./use-render-list";

interface RenderProps {
  item: IRenderItem;
  indent: boolean;
  onLocation: (group: IProxyGroupItem) => void;
  onCheckAll: (groupName: string) => void;
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void;
  onChangeProxy: (group: IProxyGroupItem, proxy: IProxyItem) => void;
}

interface ProxyColProps {
  item: IRenderItem;
  onChangeProxy: (group: IProxyGroupItem, proxy: IProxyItem) => void;
}

const StyledPrimary = styled("span")`
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const StyledSubtitle = styled("span")`
  font-size: 13px;
  overflow: hidden;
  color: text.secondary;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ListItemTextChild = styled("span")`
  display: block;
`;

const StyledTypeBox = styled(ListItemTextChild)(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.primary.main, 0.5),
  color: alpha(theme.palette.primary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  padding: "0 4px",
  lineHeight: 1.5,
  marginRight: "8px",
}));

const ProxyItemMiniCol = memo(function ProxyItemMiniCol(props: ProxyColProps) {
  const { item, onChangeProxy } = props;
  const { group, headState, proxyCol } = item;
  return (
    <Box
      sx={{
        height: 56,
        display: "grid",
        gap: 1,
        px: 2,
        mb: 1,
        gridTemplateColumns: `repeat(${item.col! || 2}, 1fr)`,
      }}>
      {proxyCol?.map((proxy) => (
        <ProxyItemMini
          key={item.key + proxy.name}
          groupName={group.name}
          proxy={proxy!}
          fixed={group.fixed === proxy.name}
          selected={group.now === proxy.name}
          showType={headState?.showType}
          onClick={() => onChangeProxy(group, proxy!)}
        />
      ))}
    </Box>
  );
});

export const ProxyRender = (props: RenderProps) => {
  const { indent, item, onLocation, onCheckAll, onHeadState, onChangeProxy } =
    props;
  const { type, group, headState, proxy } = item;
  const { verge } = useVerge();
  const enable_group_icon = verge?.enable_group_icon ?? true;
  const [iconCachePath, setIconCachePath] = useState("");

  useEffect(() => {
    initIconCachePath();
  }, [group]);

  const initIconCachePath = useMemoizedFn(async () => {
    if (group.icon && group.icon.trim().startsWith("http")) {
      const fileName =
        group.name.replaceAll(" ", "") + "-" + getFileName(group.icon);
      const iconPath = await downloadIconCache(group.icon, fileName);
      setIconCachePath(convertFileSrc(iconPath));
    }
  });

  const getFileName = useMemoizedFn((url: string) => {
    return url.substring(url.lastIndexOf("/") + 1);
  });

  if (type === 0) {
    return (
      <ListItemButton
        dense
        sx={(theme) => ({
          background: "#ffffff",
          ...theme.applyStyles("dark", {
            background: "#282A36",
          }),
          height: "70px",
          margin: "8px 8px 0",
          borderRadius: "8px",
          transition: "background-color 0s",
        })}
        onClick={() => onHeadState(group.name, { open: !headState?.open })}>
        {enable_group_icon &&
          group.icon &&
          group.icon.trim().startsWith("http") && (
            <img
              src={iconCachePath === "" ? group.icon : iconCachePath}
              width="32px"
              style={{ marginRight: "12px", borderRadius: "6px" }}
            />
          )}
        {enable_group_icon &&
          group.icon &&
          group.icon.trim().startsWith("data") && (
            <img
              src={group.icon}
              width="32px"
              style={{ marginRight: "12px", borderRadius: "6px" }}
            />
          )}
        {enable_group_icon &&
          group.icon &&
          group.icon.trim().startsWith("<svg") && (
            <img
              src={`data:image/svg+xml;base64,${btoa(group.icon)}`}
              width="32px"
            />
          )}
        <ListItemText
          primary={<StyledPrimary>{group.name}</StyledPrimary>}
          secondary={
            <ListItemTextChild
              sx={{
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                pt: "2px",
              }}>
              <span style={{ marginTop: "2px", display: "block" }}>
                <StyledTypeBox>{group.type}</StyledTypeBox>
                <StyledSubtitle sx={{ color: "text.secondary" }}>
                  {group.now}
                </StyledSubtitle>
              </span>
            </ListItemTextChild>
          }
          secondaryTypographyProps={{
            sx: { display: "flex", alignItems: "center", color: "#ccc" },
          }}
        />
        {headState?.open ? <ExpandLessRounded /> : <ExpandMoreRounded />}
      </ListItemButton>
    );
  }

  if (type === 1) {
    return (
      <ProxyHead
        sx={{ pl: 2, pr: 3, mt: indent ? 1 : 0.5, mb: 1 }}
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
        group={group}
        proxy={proxy!}
        selected={group.now === proxy?.name}
        showType={headState?.showType}
        sx={{ py: 0, pl: 2 }}
        onClick={() => onChangeProxy(group, proxy!)}
      />
    );
  }

  if (type === 3) {
    return (
      <Box
        sx={{
          py: 2,
          pl: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}>
        <InboxRounded sx={{ fontSize: "2.5em", color: "inherit" }} />
        <Typography sx={{ color: "inherit" }}>No Proxies</Typography>
      </Box>
    );
  }

  if (type === 4) {
    return <ProxyItemMiniCol item={item} onChangeProxy={onChangeProxy} />;
  }
};
