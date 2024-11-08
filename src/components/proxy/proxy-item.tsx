import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { CheckCircleOutlineRounded } from "@mui/icons-material";
import {
  alpha,
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  styled,
  SxProps,
  Theme,
} from "@mui/material";
import { BaseLoading } from "@/components/base";
import delayManager from "@/services/delay";
import { useVerge } from "@/hooks/use-verge";

interface Props {
  group: IProxyGroupItem;
  proxy: IProxyItem;
  selected: boolean;
  showType?: boolean;
  sx?: SxProps<Theme>;
  onClick?: (name: string) => void;
}

const Widget = styled(Box)(() => ({
  padding: "3px 6px",
  fontSize: 14,
  borderRadius: "4px",
}));

const TypeBox = styled("span")(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.text.secondary, 0.36),
  color: alpha(theme.palette.text.secondary, 0.42),
  borderRadius: 4,
  fontSize: 10,
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));

export const ProxyItem = (props: Props) => {
  const { group, proxy, selected, showType = true, sx, onClick } = props;

  const presetList = ["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE"];
  const isPreset = presetList.includes(proxy.name);
  // -1/<=0 为 不显示
  // -2 为 loading
  const [delay, setDelay] = useState(-1);
  const { verge } = useVerge();
  const timeout = verge?.default_latency_timeout || 10000;
  useEffect(() => {
    if (isPreset) return;
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
        sx={[
          { borderRadius: 1 },
          ({ palette: { mode, primary } }) => {
            const bgcolor = mode === "light" ? "#ffffff" : "#24252f";
            const selectColor = mode === "light" ? primary.main : primary.light;
            const showDelay = delay > 0;

            return {
              "&:hover .the-check": { display: !showDelay ? "block" : "none" },
              "&:hover .the-delay": { display: showDelay ? "block" : "none" },
              "&:hover .the-icon": { display: "none" },
              "&.Mui-selected": {
                width: `calc(100% + 3px)`,
                marginLeft: `-3px`,
                borderLeft: `3px solid ${selectColor}`,
                bgcolor:
                  mode === "light"
                    ? alpha(primary.main, 0.15)
                    : alpha(primary.main, 0.35),
              },
              backgroundColor: bgcolor,
              marginBottom: "8px",
              height: "40px",
            };
          },
        ]}
      >
        <ListItemText
          title={proxy.name}
          secondary={
            <>
              <Box
                sx={{
                  display: "inline-block",
                  marginRight: "8px",
                  fontSize: "14px",
                  color: "text.primary",
                }}
              >
                {proxy.name}
                {showType && proxy.now && ` - ${proxy.now}`}
              </Box>
              {showType && !!proxy.provider && (
                <TypeBox>{proxy.provider}</TypeBox>
              )}
              {showType && <TypeBox>{proxy.type}</TypeBox>}
              {showType && proxy.udp && <TypeBox>UDP</TypeBox>}
              {showType && proxy.xudp && <TypeBox>XUDP</TypeBox>}
              {showType && proxy.tfo && <TypeBox>TFO</TypeBox>}
              {showType && proxy.mptcp && <TypeBox>MPTCP</TypeBox>}
              {showType && proxy.smux && <TypeBox>SMUX</TypeBox>}
            </>
          }
        />

        <ListItemIcon
          sx={{
            justifyContent: "flex-end",
            color: "primary.main",
            display: isPreset ? "none" : "",
          }}
        >
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
              })}
            >
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
              color={delayManager.formatDelayColor(delay, timeout)}
              sx={({ palette }) =>
                !proxy.provider
                  ? { ":hover": { bgcolor: alpha(palette.primary.main, 0.15) } }
                  : {}
              }
            >
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
