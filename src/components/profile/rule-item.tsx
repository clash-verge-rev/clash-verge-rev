import {
  Box,
  Divider,
  IconButton,
  ListItem,
  ListItemText,
  Typography,
  alpha,
} from "@mui/material";
import { DeleteForeverRounded, UndoRounded } from "@mui/icons-material";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
interface Props {
  type: "prepend" | "original" | "delete" | "append";
  ruleRaw: string;
  onDelete: () => void;
}

export const RuleItem = (props: Props) => {
  let { type, ruleRaw, onDelete } = props;
  const rule = ruleRaw.replace(",no-resolve", "").split(",");
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: ruleRaw });
  return (
    <ListItem
      sx={({ palette }) => ({
        p: 0,
        borderRadius: "10px",
        border: "solid 2px",
        borderColor:
          type === "original"
            ? "var(--divider-color)"
            : type === "delete"
            ? alpha(palette.error.main, 0.5)
            : alpha(palette.success.main, 0.5),
        mb: 1,
        transform: CSS.Transform.toString(transform),
        transition,
      })}
    >
      <ListItemText
        {...attributes}
        {...listeners}
        ref={setNodeRef}
        sx={{ px: 1 }}
        primary={
          <>
            <Typography
              sx={{ textDecoration: type === "delete" ? "line-through" : "" }}
              variant="h6"
              component="span"
              noWrap
            >
              {rule.length === 3 ? rule[1] : "-"}
            </Typography>
          </>
        }
        secondary={
          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Box>{rule[0]}</Box>
            <Box>{rule.length === 3 ? rule[2] : rule[1]}</Box>
          </Box>
        }
      />
      <Divider orientation="vertical" flexItem />
      <IconButton size="small" color="inherit" onClick={onDelete}>
        {type === "delete" ? <UndoRounded /> : <DeleteForeverRounded />}
      </IconButton>
    </ListItem>
  );
};
