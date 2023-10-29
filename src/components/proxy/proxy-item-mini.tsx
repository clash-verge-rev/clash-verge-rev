import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { CheckCircleOutlineRounded } from "@mui/icons-material";
import { alpha, Box, ListItemButton, styled, Typography } from "@mui/material";
import { BaseLoading } from "@/components/base";
import delayManager from "@/services/delay";

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
    setDelay(await delayManager.checkDelay(proxy.name, groupName));
  });

  return (
    <ListItemButton
      dense
      selected={selected}
      onClick={() => onClick?.(proxy.name)}
      sx={[
        {
          height: 56,
          borderRadius: 1,
          pl: 1.5,
          pr: 1,
          justifyContent: "space-between",
          alignItems: "center",
        },
        ({ palette: { mode, primary } }) => {
          const bgcolor =
            mode === "light"
              ? alpha(primary.main, 0.15)
              : alpha(primary.main, 0.35);
          const color = mode === "light" ? primary.main : primary.light;
          const showDelay = delay > 0;

          const shadowColor =
            mode === "light" ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.08)";

          return {
            "&:hover .the-check": { display: !showDelay ? "block" : "none" },
            "&:hover .the-delay": { display: showDelay ? "block" : "none" },
            "&:hover .the-icon": { display: "none" },
            "&.Mui-selected": { bgcolor, boxShadow: `0 0 0 1px ${bgcolor}` },
            "&.Mui-selected .MuiListItemText-secondary": { color },
            boxShadow: `0 0 0 1px ${shadowColor}`,
          };
        },
      ]}
    >
      <Box title={proxy.name} sx={{ overflow: "hidden" }}>
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
          }}
        >
          {proxy.name}
        </Typography>

        {showType && (
          <Box sx={{ display: "flex", flexWrap: "nowrap", flex: "none" }}>
            {!!proxy.provider && (
              <TypeBox component="span">{proxy.provider}</TypeBox>
            )}
            <TypeBox component="span">{proxy.type}</TypeBox>
            {proxy.udp && <TypeBox component="span">UDP</TypeBox>}
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
            color={delayManager.formatDelayColor(delay)}
            sx={({ palette }) =>
              !proxy.provider
                ? { ":hover": { bgcolor: alpha(palette.primary.main, 0.15) } }
                : {}
            }
          >
            {delayManager.formatDelay(delay)}
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
  padding: "3px 6px",
  fontSize: 14,
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
  padding: "0 2px",
  lineHeight: 1.25,
}));
