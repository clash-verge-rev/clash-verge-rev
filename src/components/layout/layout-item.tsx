import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  alpha,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import type { CSSProperties, ReactNode } from "react";
import { useMatch, useNavigate, useResolvedPath } from "react-router";

import { useVerge } from "@/hooks/use-verge";

interface SortableProps {
  setNodeRef?: (element: HTMLElement | null) => void;
  attributes?: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
  style?: CSSProperties;
  isDragging?: boolean;
  disabled?: boolean;
}

interface Props {
  to: string;
  children: string;
  icon: ReactNode[];
  sortable?: SortableProps;
}
export const LayoutItem = (props: Props) => {
  const { to, children, icon, sortable } = props;
  const { verge } = useVerge();
  const { menu_icon } = verge ?? {};
  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: true });
  const navigate = useNavigate();

  const { setNodeRef, attributes, listeners, style, isDragging, disabled } =
    sortable ?? {};

  const draggable = Boolean(sortable) && !disabled;
  const dragHandleProps = draggable
    ? { ...(attributes ?? {}), ...(listeners ?? {}) }
    : undefined;

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={[
        { py: 0.5, maxWidth: 250, mx: "auto", padding: "4px 0px" },
        isDragging ? { opacity: 0.78 } : {},
      ]}
    >
      <ListItemButton
        selected={!!match}
        {...(dragHandleProps ?? {})}
        sx={[
          {
            borderRadius: 2,
            marginLeft: 1.25,
            paddingLeft: 1,
            paddingRight: 1,
            marginRight: 1.25,
            cursor: draggable ? "grab" : "pointer",
            "&:active": draggable ? { cursor: "grabbing" } : {},
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
        {(menu_icon === "monochrome" || !menu_icon) && (
          <ListItemIcon
            sx={{
              color: "text.primary",
              marginLeft: "6px",
              cursor: draggable ? "grab" : "inherit",
            }}
          >
            {icon[0]}
          </ListItemIcon>
        )}
        {menu_icon === "colorful" && (
          <ListItemIcon sx={{ cursor: draggable ? "grab" : "inherit" }}>
            {icon[1]}
          </ListItemIcon>
        )}
        <ListItemText
          sx={{
            textAlign: "center",
            marginLeft: menu_icon === "disable" ? "" : "-35px",
          }}
          primary={children}
        />
      </ListItemButton>
    </ListItem>
  );
};
