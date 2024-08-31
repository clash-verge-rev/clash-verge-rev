import { BaseLoading } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import delayManager from "@/services/delay";
import { CheckCircleOutlineRounded } from "@mui/icons-material";
import { alpha, Box, ListItemButton, styled, Typography } from "@mui/material";
import { useLockFn } from "ahooks";
import { useEffect, useState } from "react";

interface Props {
  groupName: string;
  proxy: IProxyItem;
  fixed: boolean;
  selected: boolean;
  showType?: boolean;
  onClick?: (name: string) => void;
}

const Widget = styled("div")(({ theme: { typography } }) => ({
  padding: "2px 4px",
  fontSize: 14,
  fontFamily: typography.fontFamily,
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

// 多列布局
export const ProxyItemMini = (props: Props) => {
  const { groupName, proxy, fixed, selected, showType = true, onClick } = props;

  // -1/<=0 为 不显示
  // -2 为 loading
  const [delay, setDelay] = useState(-1);
  const { verge } = useVerge();
  const timeout = verge?.default_latency_timeout || 5000;

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
          const bgcolor = mode === "light" ? "#ffffff" : "#24252f";
          const showDelay = delay > 0;
          const selectColor = mode === "light" ? primary.main : primary.light;

          return {
            "&:hover": {
              bgcolor:
                mode === "light"
                  ? alpha(primary.main, 0.15)
                  : alpha(primary.main, 0.35),
            },
            "&:hover .the-check": { display: !showDelay ? "block" : "none" },
            "&:hover .the-delay": { display: showDelay ? "block" : "none" },
            "&:hover .the-icon": { display: "none" },
            "& .the-pin, & .the-unpin": {
              position: "absolute",
              fontSize: "12px",
              top: "-5px",
              right: "-5px",
            },
            "& .the-unpin": { filter: "grayscale(1)" },
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
            transition: "background-color 0s",
          };
        },
      ]}>
      <Box
        width={"100%"}
        title={`${proxy.name}${proxy.now ? "\n" + proxy.now : ""}`}
        sx={{ overflow: "hidden" }}>
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
          }}>
          {proxy.name}
        </Typography>

        {showType && (
          <Box
            sx={{
              display: "flex",
              flexWrap: "nowrap",
              flex: "none",
              marginTop: "4px",
            }}>
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
                  marginRight: "8px",
                }}>
                {proxy.now}
              </Typography>
            )}
            {!!proxy.provider && (
              <TypeSpan color="text.secondary">{proxy.provider}</TypeSpan>
            )}
            <TypeSpan color="text.secondary">{proxy.type}</TypeSpan>
            {proxy.udp && <TypeSpan color="text.secondary">UDP</TypeSpan>}
            {proxy.xudp && <TypeSpan color="text.secondary">XUDP</TypeSpan>}
            {proxy.tfo && <TypeSpan color="text.secondary">TFO</TypeSpan>}
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
            })}>
            Check
          </Widget>
        )}

        {delay >= 0 && (
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
        {delay !== -2 && delay < 0 && selected && (
          // 展示已选择的icon
          <CheckCircleOutlineRounded
            className="the-icon"
            sx={{ fontSize: 16, mr: 0.5, display: "block" }}
          />
        )}
      </Box>

      {fixed && (
        // 展示fixed状态
        <span className={selected ? "the-pin" : "the-unpin"}>📌</span>
      )}
    </ListItemButton>
  );
};
