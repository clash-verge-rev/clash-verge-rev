import { useSortable } from '@dnd-kit/react/sortable'
import { useTheme } from '@mui/material'
import { type CSSProperties, type ReactNode, useCallback } from 'react'

export interface SortableItemRenderProps {
  ref: (element: HTMLElement | null) => void
  handleRef: (element: HTMLElement | null) => void
  style: CSSProperties
}

interface SortableItemProps {
  id: string
  index: number
  group?: string
  disabled?: boolean
  // 用于给 tanstack virtual 列表测量当前拖动元素尺寸
  measureElement?: (element: HTMLDivElement | null) => void
  dataIndex?: number
  style?: CSSProperties
  children: ReactNode | ((props: SortableItemRenderProps) => ReactNode)
}

export const SortableItem = (props: SortableItemProps) => {
  const {
    id,
    index,
    group,
    disabled,
    measureElement,
    dataIndex,
    children,
    style,
  } = props
  const { ref, handleRef, sortable, isDragging } = useSortable({
    id,
    index,
    group,
    disabled,
  })
  const theme = useTheme()
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      handleRef(element?.querySelector('[data-sortable-handle]') ?? null)
      ref(element)
      measureElement?.(element)
    },
    [handleRef, ref, measureElement],
  )

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

  if (typeof children === 'function') {
    return children({ ref, handleRef, style: mergedStyle })
  }

  return (
    <div ref={setRef} data-index={dataIndex} style={mergedStyle}>
      {children}
    </div>
  )
}
