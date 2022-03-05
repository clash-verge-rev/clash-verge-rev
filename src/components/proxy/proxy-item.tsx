import { useEffect, useRef, useState } from "react";
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
import { ApiType } from "../../services/types";
import delayManager from "../../services/delay";

interface Props {
  groupName: string;
  proxy: ApiType.ProxyItem;
  selected: boolean;
  showType?: boolean;
  sx?: SxProps<Theme>;
  onClick?: (name: string) => void;
}

const Widget = styled(Box)(() => ({
  padding: "4px 6px",
  fontSize: 14,
}));

const TypeBox = styled(Box)(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.text.secondary, 0.36),
  color: alpha(theme.palette.text.secondary, 0.42),
  borderRadius: 4,
  fontSize: 10,
  marginLeft: 4,
  padding: "0 2px",
  lineHeight: 1.25,
}));

const ProxyItem = (props: Props) => {
  const { groupName, proxy, selected, showType = true, sx, onClick } = props;
  const [delay, setDelay] = useState(-1);

  useEffect(() => {
    if (proxy) {
      setDelay(delayManager.getDelay(proxy.name, groupName));
    }
  }, [proxy]);

  const delayRef = useRef(false);
  const onDelay = (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    if (delayRef.current) return;
    delayRef.current = true;

    delayManager
      .checkDelay(proxy.name, groupName)
      .then((result) => setDelay(result))
      .catch(() => setDelay(1e6))
      .finally(() => (delayRef.current = false));
  };

  return (
    <ListItem sx={sx}>
      <ListItemButton
        dense
        selected={selected}
        onClick={() => onClick?.(proxy.name)}
        sx={[
          { borderRadius: 1 },
          ({ palette: { mode, primary } }) => {
            const bgcolor =
              mode === "light"
                ? alpha(primary.main, 0.15)
                : alpha(primary.main, 0.35);
            const color = mode === "light" ? primary.main : primary.light;

            const showDelay = delay > 0;
            const showIcon = !showDelay && selected;

            return {
              ".the-check": { display: "none" },
              ".the-delay": { display: showDelay ? "block" : "none" },
              ".the-icon": { display: showIcon ? "block" : "none" },
              "&:hover .the-check": { display: !showDelay ? "block" : "none" },
              "&:hover .the-delay": { display: showDelay ? "block" : "none" },
              "&:hover .the-icon": { display: "none" },
              "&.Mui-selected": { bgcolor },
              "&.Mui-selected .MuiListItemText-secondary": { color },
            };
          },
        ]}
      >
        <ListItemText
          title={proxy.name}
          secondary={
            <>
              {proxy.name}

              {showType && <TypeBox component="span">{proxy.type}</TypeBox>}
              {showType && proxy.udp && <TypeBox component="span">UDP</TypeBox>}
            </>
          }
        />

        <ListItemIcon
          sx={{ justifyContent: "flex-end", color: "primary.main" }}
        >
          <Widget className="the-check" onClick={onDelay}>
            Check
          </Widget>

          <Widget
            className="the-delay"
            onClick={onDelay}
            color={
              delay > 500
                ? "error.main"
                : delay < 100
                ? "success.main"
                : "text.secondary"
            }
          >
            {delay > 1e5 ? "Error" : delay > 3000 ? "Timeout" : `${delay}ms`}
          </Widget>

          <CheckCircleOutlineRounded
            className="the-icon"
            sx={{ fontSize: 16 }}
          />
        </ListItemIcon>
      </ListItemButton>
    </ListItem>
  );
};

export default ProxyItem;
