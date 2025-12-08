import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  alpha,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Tooltip,
} from "@mui/material";
import type { CSSProperties, ReactNode } from "react";
import { useMatch, useResolvedPath, useNavigate } from "react-router";

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
  const { menu_icon, navigation_collapsed } = verge ?? {};
  const resolved = useResolvedPath(to);
  const match = useMatch({ path: resolved.pathname, end: true });
  const navigate = useNavigate();

  const { setNodeRef, attributes, listeners, style, isDragging } =
    sortable ?? {};

  const button = (
    <ListItemButton
      selected={!!match}
      sx={[
        {
          borderRadius: 2,
          marginLeft: 1.25,
          paddingLeft: navigation_collapsed ? 0.75 : 1,
          paddingRight: navigation_collapsed ? 0.75 : 1,
          marginRight: 1.25,
          cursor: sortable && !sortable.disabled ? "grab" : "pointer",
          justifyContent: navigation_collapsed ? "center" : "flex-start",
          gap: navigation_collapsed ? 0 : undefined,
          "& .MuiListItemText-primary": {
            color: "text.primary",
            fontWeight: "700",
          },
          "& .MuiListItemIcon-root": {
            minWidth: navigation_collapsed ? 0 : undefined,
            marginRight: navigation_collapsed ? 0 : undefined,
            display: "flex",
            justifyContent: "center",
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
      {...(attributes ?? {})}
      {...(listeners ?? {})}
    >
      {(menu_icon === "monochrome" || !menu_icon) && (
        <ListItemIcon
          sx={{
            color: "text.primary",
            marginLeft: navigation_collapsed ? 0 : "6px",
          }}
        >
          {icon[0]}
        </ListItemIcon>
      )}
      {menu_icon === "colorful" && <ListItemIcon>{icon[1]}</ListItemIcon>}
      {!navigation_collapsed && (
        <ListItemText
          sx={{
            textAlign: "center",
            marginLeft: menu_icon === "disable" ? "" : "-35px",
          }}
          primary={children}
        />
      )}
    </ListItemButton>
  );

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      sx={[
        { py: 0.5, maxWidth: 250, mx: "auto", padding: "4px 0px" },
        isDragging ? { opacity: 0.78 } : {},
      ]}
    >
      {navigation_collapsed ? (
        <Tooltip
          title={children}
          placement="right"
          enterDelay={500}
          enterNextDelay={500}
          enterTouchDelay={0}
          leaveDelay={0}
          disableInteractive
        >
          {button}
        </Tooltip>
      ) : (
        button
      )}
    </ListItem>
  );
};
