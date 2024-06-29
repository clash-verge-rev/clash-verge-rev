import { Data } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, SxProps } from "@mui/material";
import React from "react";

export const DraggableItem = ({
  id,
  sx,
  data,
  children,
}: {
  id: string;
  sx?: SxProps;
  data?: Data;
  children: React.ReactNode;
}) => {
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
