import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box } from '@mui/material'

import { ProfileItem, type ProfileItemProps } from './profile-item'

type SortableProfileItemProps = Omit<
  ProfileItemProps,
  'dragHandleRef' | 'dragHandleAttributes' | 'dragHandleListeners'
> & {
  id: string
}

export const SortableProfileItem = ({
  id,
  ...profileItemProps
}: SortableProfileItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <Box
      sx={{
        position: 'relative',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined,
      }}
    >
      <ProfileItem
        {...profileItemProps}
        dragHandleRef={setNodeRef}
        dragHandleAttributes={attributes}
        dragHandleListeners={listeners}
      />
    </Box>
  )
}
