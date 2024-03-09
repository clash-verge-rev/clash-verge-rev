import {
  alpha,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
} from "@mui/material";
import { useMatch, useResolvedPath, useNavigate } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

interface Props {
  to: string;
  children: string;
  img: string;
}
export const LayoutItem = (props: Props) => {
  const { to, children, img } = props;

  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: true });
  const navigate = useNavigate();

  return (
    <ListItem sx={{ py: 0.5, maxWidth: 250, mx: "auto", padding: "4px 0px" }}>
      <ListItemButton
        selected={!!match}
        sx={[
          {
            borderRadius: 2,
            marginLeft: 1.5,
            paddingLeft: 1,
            paddingRight: 1,
            marginRight: 1.5,
            textAlign: "left",
            "& .MuiListItemText-primary": {
              color: "text.primary",
              fontWeight: "700",
            },
          },
          ({ palette: { mode, primary } }) => {
            const bgcolor =
              mode === "light"
                ? alpha(primary.main, 0.15)
                : alpha(primary.main, 0.35);
            const color = mode === "light" ? "#1f1f1f" : "#ffffff";

            return {
              "&.Mui-selected": { bgcolor },
              "&.Mui-selected:hover": { bgcolor },
              "&.Mui-selected .MuiListItemText-primary": { color },
            };
          },
        ]}
        onClick={() => navigate(to)}
      >
        <ListItemAvatar sx={{ marginRight: -0.5 }}>
          <Avatar src={img}></Avatar>
        </ListItemAvatar>
        <ListItemText primary={children} />
      </ListItemButton>
    </ListItem>
  );
};
