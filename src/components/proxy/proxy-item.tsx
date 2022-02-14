import { CheckCircleOutlineRounded } from "@mui/icons-material";
import {
  alpha,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  SxProps,
  Theme,
} from "@mui/material";
import { ApiType } from "../../services/types";

interface Props {
  proxy: ApiType.ProxyItem;
  selected: boolean;
  sx?: SxProps<Theme>;
  onClick?: (name: string) => void;
}

const ProxyItem = (props: Props) => {
  const { proxy, selected, sx, onClick } = props;

  return (
    <ListItem sx={sx}>
      <ListItemButton
        dense
        selected={selected}
        onClick={() => onClick?.(proxy.name)}
        sx={[
          {
            borderRadius: 1,
          },
          ({ palette: { mode, primary } }) => {
            const bgcolor =
              mode === "light"
                ? alpha(primary.main, 0.15)
                : alpha(primary.main, 0.35);
            const color = mode === "light" ? primary.main : primary.light;

            return {
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
          {selected && <CheckCircleOutlineRounded sx={{ fontSize: 16 }} />}
        </ListItemIcon>
      </ListItemButton>
    </ListItem>
  );
};

export default ProxyItem;
