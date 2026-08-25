import { useSortable } from '@dnd-kit/react/sortable'
import { useTheme } from '@mui/material'
import type { CSSProperties, ReactNode } from 'react'

interface SortableItemProps {
  id: string
  index: number
  group?: string
  disabled?: boolean
  style?: CSSProperties
  children: ReactNode
}

export const SortableItem = (props: SortableItemProps) => {
  const { id, index, group, disabled, children, style } = props
  const { ref, sortable, isDragging } = useSortable({
    id,
    index,
    group,
    disabled,
  })
  const theme = useTheme()

  const mergedStyle: CSSProperties = {
    position: 'relative',
    borderRadius: 8,
    ...style,
    ...(sortable.transition && {
      transition: `${sortable.transition.duration ?? 300}ms ${sortable.transition.easing ?? 'ease'} transform`,
    }),
    ...(isDragging && {
      zIndex: 100,
      // 拖拽中的元素置为不透明背景，避免半透明卡片透出下层内容。 投影由全局 [data-dnd-dragging] 规则统一施加。
      backgroundColor: theme.palette.background.paper,
    }),
  }

  return (
    <div ref={ref} style={mergedStyle}>
      {children}
    </div>
  )
}
