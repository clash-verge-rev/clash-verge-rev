import { BaseLoading } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import delayManager from "@/services/delay";
import { CheckCircleOutlineRounded } from "@mui/icons-material";
import {
  alpha,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  styled,
  SxProps,
  Theme,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { useEffect, useState } from "react";

interface Props {
  group: IProxyGroupItem;
  proxy: IProxyItem;
  selected: boolean;
  showType?: boolean;
  sx?: SxProps<Theme>;
  onClick?: (name: string) => void;
}

const Widget = styled("div")(() => ({
  padding: "3px 6px",
  fontSize: 14,
  borderRadius: "4px",
}));

const TypeSpan = styled("span")(
  ({
    theme: {
      palette: { text },
      typography,
    },
  }) => ({
    display: "inline-block",
    border: `1px solid ${text.secondary}`,
    color: "text.secondary",
    borderRadius: 4,
    fontSize: 10,
    fontFamily: typography.fontFamily,
    marginRight: "4px",
    marginTop: "auto",
    padding: "0 4px",
    lineHeight: 1.5,
  }),
);

export const ProxyItem = (props: Props) => {
  const { group, proxy, selected, showType = true, sx, onClick } = props;

  // -1/<=0 为 不显示
  // -2 为 loading
  const [delay, setDelay] = useState(-1);
  const { verge } = useVerge();
  const timeout = verge?.default_latency_timeout || 5000;
  useEffect(() => {
    delayManager.setListener(proxy.name, group.name, setDelay);

    return () => {
      delayManager.removeListener(proxy.name, group.name);
    };
  }, [proxy.name, group.name]);

  useEffect(() => {
    if (!proxy) return;
    setDelay(delayManager.getDelayFix(proxy, group.name));
  }, [proxy]);

  const onDelay = useLockFn(async () => {
    setDelay(-2);
    setDelay(await delayManager.checkDelay(proxy.name, group.name, timeout));
  });

  return (
    <ListItem sx={sx}>
      <ListItemButton
        dense
        selected={selected}
        onClick={() => onClick?.(proxy.name)}
        sx={(theme) => {
          const showDelay = delay > 0;
          return {
            borderRadius: 1,
            "&:hover .the-check": { display: !showDelay ? "block" : "none" },
            "&:hover .the-delay": { display: showDelay ? "block" : "none" },
            "&:hover .the-icon": { display: "none" },
            "&.Mui-selected": {
              width: `calc(100% + 3px)`,
              marginLeft: `-3px`,
              bgcolor: alpha(theme.palette.primary.main, 0.15),
              borderLeft: `3px solid ${theme.palette.primary.main}`,
              ...theme.applyStyles("dark", {
                bgcolor: alpha(theme.palette.primary.main, 0.35),
                borderLeft: `3px solid ${theme.palette.primary.light}`,
              }),
            },
            backgroundColor: "#ffffff",
            ...theme.applyStyles("dark", {
              backgroundColor: "#24252f",
            }),
            transition: "background-color 0s",
            marginBottom: "8px",
            height: "40px",
          };
        }}>
        <ListItemText
          title={proxy.name}
          secondary={
            <span className="flex items-center">
              <span className="line-clamp-1">
                <span
                  style={{
                    display: "inline-block",
                    marginRight: "8px",
                    fontSize: "14px",
                    color: "text.primary",
                  }}>
                  {proxy.name}
                  {showType && proxy.now && ` - ${proxy.now}`}
                </span>
              </span>
              <span className="flex flex-nowrap">
                {showType && !!proxy.provider && (
                  <TypeSpan>{proxy.provider}</TypeSpan>
                )}
                {showType && <TypeSpan>{proxy.type}</TypeSpan>}
                {showType && proxy.udp && <TypeSpan>UDP</TypeSpan>}
                {showType && proxy.xudp && <TypeSpan>XUDP</TypeSpan>}
                {showType && proxy.tfo && <TypeSpan>TFO</TypeSpan>}
              </span>
            </span>
          }
        />

        <ListItemIcon
          sx={{ justifyContent: "flex-end", color: "primary.main" }}>
          {delay === -2 && (
            <Widget>
              <BaseLoading />
            </Widget>
          )}

          {!proxy.provider && delay !== -2 && (
            // provider的节点不支持检测
            <Widget
              className="the-check"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelay();
              }}
              sx={({ palette }) => ({
                display: "none", // hover才显示
                ":hover": { bgcolor: alpha(palette.primary.main, 0.15) },
              })}>
              Check
            </Widget>
          )}

          {delay > 0 && (
            // 显示延迟
            <Widget
              className="the-delay"
              onClick={(e) => {
                if (proxy.provider) return;
                e.preventDefault();
                e.stopPropagation();
                onDelay();
              }}
              sx={({ palette }) => ({
                color: delayManager.formatDelayColor(delay, timeout),
                ...(!proxy.provider && {
                  ":hover": { bgcolor: alpha(palette.primary.main, 0.15) },
                }),
              })}>
              {delayManager.formatDelay(delay, timeout)}
            </Widget>
          )}

          {delay !== -2 && delay <= 0 && selected && (
            // 展示已选择的icon
            <CheckCircleOutlineRounded
              className="the-icon"
              sx={{ fontSize: 16 }}
            />
          )}
        </ListItemIcon>
      </ListItemButton>
    </ListItem>
  );
};
