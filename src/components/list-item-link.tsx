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
        sx={[
          {
            color: "primary",
            borderRadius: 2,
            textAlign: "center",
          },
          (theme) => {
            if (!match) return {};

            if (theme.palette.mode === "light") {
              return {
                bgcolor: "rgba(91,92,157,0.15)",
                "&:hover": { bgcolor: "rgba(91,92,157,0.15)" },
              };
            }

            return {
              bgcolor: "rgba(91,92,157,0.35)",
              "&:hover": { bgcolor: "rgba(91,92,157,0.35)" },
            };
          },
        ]}
        onClick={() => navigate(to)}
      >
        <ListItemText
          primary={children}
          sx={{
            color: (theme) => {
              if (!match) return "text.secondary";

              const light = theme.palette.mode === "light";
              if (match && light) return "primary.main";
              return "primary.light";
            },
          }}
        />
      </ListItemButton>
    </ListItem>
  );
};

export default ListItemLink;
