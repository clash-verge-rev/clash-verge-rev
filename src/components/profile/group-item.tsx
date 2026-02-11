import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DeleteForeverRounded, UndoRounded } from "@mui/icons-material";
import {
  Box,
  IconButton,
  ListItem,
  ListItemText,
  alpha,
  styled,
} from "@mui/material";

import { useIconCache } from "@/hooks/use-icon-cache";
interface Props {
  type: "prepend" | "original" | "delete" | "append";
  group: IProxyGroupConfig;
  onDelete: () => void;
}

export const GroupItem = (props: Props) => {
  const { type, group, onDelete } = props;
  const sortable = type === "prepend" || type === "append";

  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef: sortableSetNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.name,
    disabled: !sortable,
  });
  const dragAttributes = sortable ? sortableAttributes : undefined;
  const dragListeners = sortable ? sortableListeners : undefined;
  const dragNodeRef = sortable ? sortableSetNodeRef : undefined;

  const iconCachePath = useIconCache({
    icon: group.icon,
    cacheKey: group.name.replaceAll(" ", ""),
  });

  return (
    <ListItem
      dense
      sx={({ palette }) => ({
        position: "relative",
        background:
          type === "original"
            ? palette.mode === "dark"
              ? alpha(palette.background.paper, 0.3)
              : alpha(palette.grey[400], 0.3)
            : type === "delete"
              ? alpha(palette.error.main, 0.3)
              : alpha(palette.success.main, 0.3),
        height: "100%",
        margin: "8px 0",
        borderRadius: "8px",
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? "calc(infinity)" : undefined,
      })}
    >
      {group.icon && group.icon?.trim().startsWith("http") && (
        <img
          src={iconCachePath === "" ? group.icon : iconCachePath}
          width="32px"
          style={{
            marginRight: "12px",
            borderRadius: "6px",
          }}
        />
      )}
      {group.icon && group.icon?.trim().startsWith("data") && (
        <img
          src={group.icon}
          width="32px"
          style={{
            marginRight: "12px",
            borderRadius: "6px",
          }}
        />
      )}
      {group.icon && group.icon?.trim().startsWith("<svg") && (
        <img
          src={`data:image/svg+xml;base64,${btoa(group.icon ?? "")}`}
          width="32px"
          style={{
            marginRight: "12px",
            borderRadius: "6px",
          }}
        />
      )}
      <ListItemText
        {...(dragAttributes ?? {})}
        {...(dragListeners ?? {})}
        ref={dragNodeRef}
        sx={{ cursor: sortable ? "move" : "" }}
        primary={
          <StyledPrimary
            sx={{ textDecoration: type === "delete" ? "line-through" : "" }}
          >
            {group.name}
          </StyledPrimary>
        }
        secondary={
          <ListItemTextChild
            sx={{
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              pt: "2px",
            }}
          >
            <Box sx={{ marginTop: "2px" }}>
              <StyledTypeBox>{group.type}</StyledTypeBox>
            </Box>
          </ListItemTextChild>
        }
        slotProps={{
          secondary: {
            sx: {
              display: "flex",
              alignItems: "center",
              color: "#ccc",
            },
          },
        }}
      />
      <IconButton onClick={onDelete}>
        {type === "delete" ? <UndoRounded /> : <DeleteForeverRounded />}
      </IconButton>
    </ListItem>
  );
};

const StyledPrimary = styled("div")`
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ListItemTextChild = styled("span")`
  display: block;
`;

const StyledTypeBox = styled(ListItemTextChild)(({ theme }) => ({
  display: "inline-block",
  border: "1px solid #ccc",
  borderColor: alpha(theme.palette.primary.main, 0.5),
  color: alpha(theme.palette.primary.main, 0.8),
  borderRadius: 4,
  fontSize: 10,
  padding: "0 4px",
  lineHeight: 1.5,
  marginRight: "8px",
}));
