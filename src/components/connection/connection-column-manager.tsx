import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DragIndicatorRounded } from "@mui/icons-material";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
} from "@mui/material";
import type { Column } from "@tanstack/react-table";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  columns: Column<IConnectionsItem, unknown>[];
  onClose: () => void;
  onOrderChange: (order: string[]) => void;
  onReset: () => void;
}

export const ConnectionColumnManager = ({
  open,
  columns,
  onClose,
  onOrderChange,
  onReset,
}: Props) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const { t } = useTranslation();

  const items = useMemo(() => columns.map((column) => column.id), [columns]);
  const visibleCount = useMemo(
    () => columns.filter((column) => column.getIsVisible()).length,
    [columns],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const order = columns.map((column) => column.id);
      const oldIndex = order.indexOf(active.id as string);
      const newIndex = order.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      onOrderChange(arrayMove(order, oldIndex, newIndex));
    },
    [columns, onOrderChange],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t("connections.components.columnManager.title")}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items}>
            <List
              dense
              disablePadding
              sx={{ display: "flex", flexDirection: "column", gap: 1 }}
            >
              {columns.map((column) => (
                <SortableColumnItem
                  key={column.id}
                  column={column}
                  label={getColumnLabel(column)}
                  dragHandleLabel={t(
                    "connections.components.columnManager.dragHandle",
                  )}
                  disableToggle={
                    !column.getCanHide() ||
                    (column.getIsVisible() && visibleCount <= 1)
                  }
                />
              ))}
            </List>
          </SortableContext>
        </DndContext>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={onReset}>
          {t("shared.actions.resetToDefault")}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t("shared.actions.close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface SortableColumnItemProps {
  column: Column<IConnectionsItem, unknown>;
  label: string;
  dragHandleLabel: string;
  disableToggle?: boolean;
}

const SortableColumnItem = ({
  column,
  label,
  dragHandleLabel,
  disableToggle = false,
}: SortableColumnItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style = useMemo(
    () => ({
      transform: CSS.Transform.toString(transform),
      transition,
    }),
    [transform, transition],
  );

  return (
    <ListItem
      ref={setNodeRef}
      disableGutters
      sx={{
        px: 1,
        py: 0.5,
        borderRadius: 1,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        backgroundColor: isDragging ? "action.hover" : "transparent",
        display: "flex",
        alignItems: "center",
        gap: 1,
      }}
      style={style}
    >
      <Checkbox
        edge="start"
        checked={column.getIsVisible()}
        disabled={disableToggle}
        onChange={(event) => column.toggleVisibility(event.target.checked)}
      />
      <ListItemText
        primary={label}
        slotProps={{ primary: { variant: "body2" } }}
        sx={{ mr: 1 }}
      />
      <IconButton
        edge="end"
        size="small"
        sx={{ cursor: isDragging ? "grabbing" : "grab" }}
        aria-label={dragHandleLabel}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorRounded fontSize="small" />
      </IconButton>
    </ListItem>
  );
};

const getColumnLabel = (column: Column<IConnectionsItem, unknown>) => {
  const meta = column.columnDef.meta as { label?: string } | undefined;
  if (meta?.label) return meta.label;

  const header = column.columnDef.header;
  return typeof header === "string" ? header : column.id;
};
