import { move } from '@dnd-kit/helpers'
import {
  DragDropProvider,
  type DragEndEvent,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
} from '@dnd-kit/react'
import { isSortable, isSortableOperation } from '@dnd-kit/react/sortable'
import { useVirtualizer } from '@tanstack/react-virtual'
import { type CSSProperties, type ReactNode, useRef, useState } from 'react'

import { SortableItem } from '../base'

type GroupedVirtualCategory = 'prepend' | 'original' | 'append'

export interface GroupedVirtualItem<T> {
  id: string
  category: GroupedVirtualCategory
  item: T
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildGroupedItems<T>(
  prepend: T[],
  original: T[],
  append: T[],
  getKey: (item: T) => string,
): GroupedVirtualItem<T>[] {
  const build = (
    category: GroupedVirtualCategory,
    list: T[],
  ): GroupedVirtualItem<T>[] =>
    list.map((item) => ({
      id: `${category}:${getKey(item)}`,
      category,
      item,
    }))

  return [
    ...build('prepend', prepend),
    ...build('original', original),
    ...build('append', append),
  ]
}

interface GroupedVirtualListProps<T> {
  items: GroupedVirtualItem<T>[]
  estimateSize?: number
  renderItem: (entry: GroupedVirtualItem<T>) => ReactNode
  onReorder: (
    category: 'prepend' | 'append',
    activeIndex: number,
    overIndex: number,
  ) => void
  style?: CSSProperties
}

/**
 * 用于编辑规则/节点/代理组功能的 prepend/original/append 分组虚拟化列表
 */
export function GroupedVirtualList<T>(props: GroupedVirtualListProps<T>) {
  const {
    items: itemsProp,
    estimateSize = 56,
    renderItem,
    onReorder,
    style,
  } = props
  const [items, setItems] = useState(itemsProp)
  const [prevItemsProp, setPrevItemsProp] = useState(itemsProp)
  const snapshotRef = useRef(itemsProp)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (itemsProp !== prevItemsProp) {
    setPrevItemsProp(itemsProp)
    setItems(itemsProp)
  }

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan: 15,
    gap: 8,
    getItemKey: (index) => items[index]?.id ?? index,
  })

  const onDragStart = () => {
    snapshotRef.current = items
  }

  const onDragOver = (event: DragOverEvent) => {
    const { operation } = event
    if (!isSortableOperation(operation)) return

    const { source, target } = operation
    if (!source || !target) return

    const sourceEntry = items.find((entry) => entry.id === source.id)
    const targetEntry = items.find((entry) => entry.id === target.id)
    if (
      !sourceEntry ||
      !targetEntry ||
      sourceEntry.category !== targetEntry.category
    ) {
      event.preventDefault()
      return
    }

    setItems((current) => move(current, event))
  }

  const onDragEnd = (event: DragEndEvent) => {
    const source = event.operation.source

    if (event.canceled) {
      setItems(snapshotRef.current)
      return
    }

    if (!isSortable(source)) return

    const snapshot = snapshotRef.current
    const sourceEntry = snapshot.find((entry) => entry.id === source.id)
    if (!sourceEntry) return

    const { category } = sourceEntry
    if (category !== 'prepend' && category !== 'append') return

    const activeIndex = snapshot
      .filter((entry) => entry.category === category)
      .findIndex((entry) => entry.id === source.id)
    const overIndex = items
      .filter((entry) => entry.category === category)
      .findIndex((entry) => entry.id === source.id)
    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return

    onReorder(category, activeIndex, overIndex)
  }

  return (
    <DragDropProvider
      sensors={[PointerSensor, KeyboardSensor]}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div ref={scrollRef} style={{ ...style, overflow: 'auto' }}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
            marginRight: '4px',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const entry = items[vi.index]
            if (!entry) return null

            return (
              <SortableItem
                key={vi.key}
                id={entry.id}
                index={vi.index}
                disabled={entry.category === 'original'}
                measureElement={virtualizer.measureElement}
                dataIndex={vi.index}
                style={{
                  position: 'absolute',
                  top: `${vi.start}px`,
                  left: 0,
                  width: '100%',
                }}
              >
                {renderItem(entry)}
              </SortableItem>
            )
          })}
        </div>
      </div>
    </DragDropProvider>
  )
}
