import { ListItem, ListItemButton, ListItemText } from "@mui/material";
import { useMatch, useResolvedPath, useNavigate } from "react-router-dom";
import type { LinkProps } from "react-router-dom";

const ListItemLink = (props: LinkProps) => {
  const { to, children } = props;

  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: true });
  const navigate = useNavigate();

  return (
    <ListItem sx={{ py: 0.5, maxWidth: 250, mx: "auto" }}>
      <ListItemButton
        sx={{
          borderRadius: 2,
          textAlign: "center",
          bgcolor: match ? "rgba(91,92,157,0.15)" : "transparent",
        }}
        onClick={() => navigate(to)}
      >
        <ListItemText
          primary={children}
          sx={{ color: match ? "primary.main" : "text.primary" }}
        />
      </ListItemButton>
    </ListItem>
  );
};

export default ListItemLink;
