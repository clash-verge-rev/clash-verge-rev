import { Data } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, SxProps } from "@mui/material";
import React from "react";

interface DraggableItemProps {
  id: string;
  sx?: SxProps;
  data?: Data;
  children: React.ReactNode;
}

export const DraggableItem = (props: DraggableItemProps) => {
  const { id, sx, data, children } = props;
  const { attributes, setNodeRef, listeners, transform, transition } =
    useSortable({ id, data });

  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      sx={{
        transform: CSS.Transform.toString(transform),
        transition,
        ...sx,
      }}>
      {children}
    </Box>
  );
};
