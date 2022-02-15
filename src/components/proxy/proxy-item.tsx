import { useEffect, useState } from "react";
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
  sx?: SxProps<Theme>;
  onClick?: (name: string) => void;
}

const Widget = styled(Box)(() => ({
  padding: "4px 6px",
  fontSize: 14,
}));

const ProxyItem = (props: Props) => {
  const { groupName, proxy, selected, sx, onClick } = props;
  const [delay, setDelay] = useState(-1);

  useEffect(() => {
    if (proxy) {
      setDelay(delayManager.getDelay(proxy.name, groupName));
    }
  }, [proxy]);

  const onDelay = (e: any) => {
    e.preventDefault();
    e.stopPropagation();

    delayManager
      .checkDelay(proxy.name, groupName)
      .then((result) => setDelay(result))
      .catch(() => setDelay(1e6));
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
        <ListItemText title={proxy.name} secondary={proxy.name} />

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
