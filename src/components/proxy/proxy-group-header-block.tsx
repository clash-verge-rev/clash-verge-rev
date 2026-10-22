import { pointerIntersection } from '@dnd-kit/collision'
import { Feedback } from '@dnd-kit/dom'
import { DOMRectangle, supportsPopover } from '@dnd-kit/dom/utilities'
import { useDraggable, useDroppable } from '@dnd-kit/react'
import { alpha, Box, type SxProps, type Theme } from '@mui/material'
import { type ReactNode, useCallback } from 'react'

const headerFeedbackPlugins = [
  Feedback.configure({
    feedback: (source, manager) => {
      if (supportsPopover(document.body)) return 'default'

      // Virtual rows offset fixed feedback without Popover. Collision detection
      // still needs a moving shape when the visible blocks stay in place.
      if (source.element && manager.dragOperation.status.initialized) {
        const { x, y } = manager.dragOperation.transform
        manager.dragOperation.shape = new DOMRectangle(
          source.element,
        ).translate(x, y)
      }
      return 'none'
    },
  }),
]

interface ProxyGroupHeaderBlockProps {
  group: string
  block: 'name' | 'tools'
  sx?: SxProps<Theme>
  children: ReactNode
}

export const ProxyGroupHeaderBlock = ({
  group,
  block,
  sx,
  children,
}: ProxyGroupHeaderBlockProps) => {
  const id = `${group}:${block}`
  const counterpart = `${group}:${block === 'name' ? 'tools' : 'name'}`
  const { ref: draggableRef, isDragging } = useDraggable({
    id,
    type: id,
    plugins: headerFeedbackPlugins,
  })
  // A block only accepts its own counterpart: every rendered header is its own
  // scope because the sticky copy and the hidden measuring copy of a group
  // overlap exactly. Pointer-only detection keeps the swap decision the same
  // however different the two blocks' widths are.
  const { ref: droppableRef, isDropTarget } = useDroppable({
    id,
    accept: counterpart,
    collisionDetector: pointerIntersection,
  })
  const setRef = useCallback(
    (element: Element | null) => {
      draggableRef(element)
      droppableRef(element)
    },
    [draggableRef, droppableRef],
  )

  return (
    <Box
      ref={setRef}
      // The header button already handles keyboard use; keep the block out of the tab order.
      tabIndex={-1}
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          minWidth: 0,
          borderRadius: 2,
        },
        isDragging && { bgcolor: 'background.paper' },
        isDropTarget && {
          bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.12),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  )
}
