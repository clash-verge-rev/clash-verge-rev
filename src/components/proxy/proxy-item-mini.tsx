import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { CheckCircleOutlineRounded } from "@mui/icons-material";
import { alpha, Box, ListItemButton, styled, Typography } from "@mui/material";
import { BaseLoading } from "@/components/base";
import delayManager from "@/services/delay";
import { useVerge } from "@/hooks/use-verge";

interface Props {
  groupName: string;
  proxy: IProxyItem;
  selected: boolean;
  showType?: boolean;
  onClick?: (name: string) => void;
}

// 多列布局
export const ProxyItemMini = (props: Props) => {
  const { groupName, proxy, selected, showType = true, onClick } = props;

  // -1/<=0 为 不显示
  // -2 为 loading
  const [delay, setDelay] = useState(-1);
  const { verge } = useVerge();
  const timeout = verge?.default_latency_timeout || 10000;

  useEffect(() => {
    delayManager.setListener(proxy.name, groupName, setDelay);

    return () => {
      delayManager.removeListener(proxy.name, groupName);
    };
  }, [proxy.name, groupName]);

  useEffect(() => {
    if (!proxy) return;
    setDelay(delayManager.getDelayFix(proxy, groupName));
  }, [proxy]);

  const onDelay = useLockFn(async () => {
    setDelay(-2);
    setDelay(await delayManager.checkDelay(proxy.name, groupName, timeout));
  });

  return (
    <ListItemButton
      dense
      selected={selected}
      onClick={() => onClick?.(proxy.name)}
      sx={[
        {
          height: 56,
          borderRadius: 1.5,
          pl: 1.5,
          pr: 1,
          justifyContent: "space-between",
          alignItems: "center",
        },
        ({ palette: { mode, primary } }) => {
          const bgcolor = mode === "light" ? "#ffffff" : "#ffffff";
          const color = mode === "light" ? primary.main : primary.light;
          const showDelay = delay > 0;

          const selectColor = mode === "light" ? primary.main : primary.light;

          return {
            "&:hover .the-check": { display: !showDelay ? "block" : "none" },
            "&:hover .the-delay": { display: showDelay ? "block" : "none" },
            "&:hover .the-icon": { display: "none" },
            "&.Mui-selected": {
              borderLeft: `3px solid ${selectColor}`,
              bgcolor,
            },
            "&.Mui-selected .MuiListItemText-secondary": { color },
            backgroundColor: "#ffffff",
          };
        },
      ]}
    >
      <Box title={proxy.name} sx={{ overflow: "hidden" }}>
        <Typography
          variant="body2"
          component="div"
          color="text.primary"
          sx={{
            display: "block",
            textOverflow: "ellipsis",
            wordBreak: "break-all",
            overflow: "hidden",
            whiteSpace: "nowrap",
            fontSize: "13px",
            fontWeight: "700",
          }}
        >
          {proxy.name}
        </Typography>

        {showType && (
          <Box
            sx={{
              display: "flex",
              flexWrap: "nowrap",
              flex: "none",
              marginTop: "4px",
            }}
          >
            {proxy.now && (
              <Typography
                variant="body2"
                component="div"
                color="text.secondary"
                sx={{
                  display: "block",
                  textOverflow: "ellipsis",
                  wordBreak: "break-all",
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  fontSize: "11px",
                  fontWeight: "700",
                  marginRight: "8px",
                }}
              >
                {proxy.now}
              </Typography>
            )}
            {!!proxy.provider && (
              <TypeBox component="span">{proxy.provider}</TypeBox>
            )}
            <TypeBox component="span">{proxy.type}</TypeBox>
            {proxy.udp && <TypeBox component="span">UDP</TypeBox>}
            {proxy.xudp && <TypeBox component="span">XUDP</TypeBox>}
            {proxy.tfo && <TypeBox component="span">TFO</TypeBox>}
          </Box>
        )}
      </Box>

      <Box sx={{ ml: 0.5, color: "primary.main" }}>
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
            sx={{ fontSize: 16, mr: 0.5, display: "block" }}
          />
        )}
      </Box>
    </ListItemButton>
  );
};

const Widget = styled(Box)(({ theme: { typography } }) => ({
  padding: "2px 4px",
  fontSize: 12,
  fontFamily: typography.fontFamily,
  borderRadius: "4px",
}));

const TypeBox = styled(Box)(({ theme: { palette, typography } }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(palette.text.secondary, 0.36),
  color: alpha(palette.text.secondary, 0.42),
  borderRadius: 4,
  fontSize: 10,
  fontFamily: typography.fontFamily,
  marginRight: "4px",
  marginTop: "auto",
  padding: "0 2px",
  lineHeight: 1.25,
}));

const TypeTypo = styled(Box)(({ theme: { palette, typography } }) => ({
  display: "inline-block",
  fontSize: 10,
  fontFamily: typography.fontFamily,
  marginRight: "4px",
  padding: "0 2px",
  lineHeight: 1.25,
}));
