import { useVirtualizer } from '@tanstack/react-virtual'
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react'

type ScrollToIndexOptions = {
  align?: 'auto' | 'center' | 'end' | 'start'
  behavior?: ScrollBehavior
}

const findGroupSectionIndex = (groupIndexes: number[], itemIndex: number) => {
  let low = 0
  let high = groupIndexes.length - 1
  let matchedIndex = -1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)

    if (groupIndexes[middle] <= itemIndex) {
      matchedIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return matchedIndex
}

export interface StickyVirtualListHandle {
  getScrollElement: () => HTMLDivElement | null
  isItemScrolledPastStart: (index: number, tolerance?: number) => boolean
  scrollToIndex: (index: number, options?: ScrollToIndexOptions) => void
  isScrolling: () => boolean
  waitForScrollEnd: () => Promise<void>
}

export interface StickyVirtualListProps<TItem> {
  initialOffset?: number
  items: TItem[]
  isGroupItem: (item: TItem, index: number) => boolean
  getItemKey: (item: TItem, index: number) => React.Key
  // 组项预估高度
  estimateGroupItemHeight: number
  // 非组项预估高度
  estimateItemHeight: number
  renderGroupItem: (item: TItem, index: number, stickyed: boolean) => ReactNode
  renderItem: (item: TItem, index: number) => ReactNode
  className?: string
  style?: React.CSSProperties
  overscan?: number
}

export const StickyVirtualList = forwardRef(function StickyVirtualListInner<
  TItem,
>(
  props: StickyVirtualListProps<TItem>,
  ref: React.ForwardedRef<StickyVirtualListHandle>,
) {
  const {
    initialOffset = 0,
    items,
    isGroupItem,
    getItemKey,
    estimateGroupItemHeight,
    estimateItemHeight,
    renderGroupItem,
    renderItem,
    className,
    style,
    overscan = 8,
  } = props
  const scrollParentRef = useRef<HTMLDivElement>(null)
  const getEstimatedItemHeight = useCallback(
    (index: number) =>
      isGroupItem(items[index], index)
        ? estimateGroupItemHeight
        : estimateItemHeight,
    [estimateGroupItemHeight, estimateItemHeight, isGroupItem, items],
  )

  const groupIndexes = useMemo(
    () =>
      items.reduce<number[]>((indexes, item, index) => {
        if (isGroupItem(item, index)) indexes.push(index)
        return indexes
      }, []),
    [isGroupItem, items],
  )

  const groupSections = useMemo(
    () =>
      groupIndexes.map((groupIndex, index) => ({
        groupIndex,
        nextGroupIndex: groupIndexes[index + 1] ?? items.length,
      })),
    [groupIndexes, items.length],
  )

  const estimatedOffsets = useMemo(() => {
    const offsets = new Array<number>(items.length + 1)
    offsets[0] = 0

    for (let i = 0; i < items.length; i++) {
      offsets[i + 1] = offsets[i] + getEstimatedItemHeight(i)
    }

    return offsets
  }, [getEstimatedItemHeight, items.length])

  const rowVirtualizer = useVirtualizer({
    initialOffset,
    count: items.length,
    estimateSize: getEstimatedItemHeight,
    getItemKey: (index) => getItemKey(items[index], index),
    getScrollElement: () => scrollParentRef.current,
    overscan,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()

  const getVirtualOffset = useCallback(
    (index: number) => {
      return (
        rowVirtualizer.measurementsCache[index]?.start ??
        estimatedOffsets[index]
      )
    },
    [estimatedOffsets, rowVirtualizer],
  )

  const visibleGroupSections = useMemo(() => {
    if (!virtualItems.length || !groupSections.length) return []

    const firstVirtualIndex = virtualItems[0].index
    const lastVirtualIndex = virtualItems[virtualItems.length - 1].index
    const matchedFirstSectionIndex = findGroupSectionIndex(
      groupIndexes,
      firstVirtualIndex,
    )
    const lastSectionIndex = findGroupSectionIndex(
      groupIndexes,
      lastVirtualIndex,
    )

    if (lastSectionIndex < 0) return []

    const firstSectionIndex =
      matchedFirstSectionIndex >= 0 ? matchedFirstSectionIndex : 0

    return groupSections.slice(
      firstSectionIndex,
      Math.min(lastSectionIndex + 2, groupSections.length),
    )
  }, [groupIndexes, groupSections, virtualItems])

  const isGroupSticky = useCallback(
    (groupIndex: number, tolerance = 0) => {
      const scroller = scrollParentRef.current
      if (!scroller) return false

      return scroller.scrollTop > getVirtualOffset(groupIndex) + tolerance
    },
    [getVirtualOffset],
  )

  useImperativeHandle(
    ref,
    () => ({
      getScrollElement: () => scrollParentRef.current,
      isItemScrolledPastStart: (index, tolerance = 0) => {
        return isGroupSticky(index, tolerance)
      },
      scrollToIndex: (index, options) => {
        rowVirtualizer.scrollToIndex(index, options)
      },
      isScrolling: () => rowVirtualizer.isScrolling,
      waitForScrollEnd: () => {
        return new Promise((resolve) => {
          let maxCheckCount = 5
          const interval = setInterval(() => {
            if (!rowVirtualizer.isScrolling || maxCheckCount < 0) {
              clearInterval(interval)
              resolve()
              return
            }

            maxCheckCount -= 1
          }, 100)
        })
      },
    }),
    [isGroupSticky, rowVirtualizer],
  )

  return (
    <div
      ref={scrollParentRef}
      className={className}
      style={{
        overflowY: 'auto',
        contain: 'strict',
        width: '100%',
        height: '100%',
        overflowAnchor: 'none',
        ...style,
      }}
    >
      <div
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: 'relative',
          width: '100%',
          paddingBottom: 10,
        }}
      >
        <div
          style={{
            inset: 0,
            pointerEvents: 'none',
            position: 'absolute',
            zIndex: 10,
          }}
        >
          {visibleGroupSections.map(({ groupIndex, nextGroupIndex }) => {
            const group = items[groupIndex]
            const start = getVirtualOffset(groupIndex)
            const end =
              nextGroupIndex < items.length
                ? getVirtualOffset(nextGroupIndex)
                : rowVirtualizer.getTotalSize()
            const stickyed = isGroupSticky(groupIndex, 1)

            return (
              <div
                key={getItemKey(group, groupIndex)}
                style={{
                  position: 'absolute',
                  top: start,
                  left: 0,
                  width: '100%',
                  height: Math.max(end - start, estimateGroupItemHeight),
                }}
              >
                <div
                  data-index={groupIndex}
                  style={{
                    pointerEvents: 'auto',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  {renderGroupItem(group, groupIndex, stickyed)}
                </div>
              </div>
            )
          })}
        </div>

        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index]
          const isGroup = isGroupItem(item, virtualRow.index)

          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                left: 0,
                position: 'absolute',
                top: 0,
                transform: `translateY(${virtualRow.start}px)`,
                width: '100%',
                zIndex: 1,
                ...(isGroup && {
                  opacity: 0,
                  zIndex: -10,
                }),
              }}
            >
              {isGroup
                ? renderGroupItem(item, virtualRow.index, false) // 渲染组，以便动态计算组高度
                : renderItem(item, virtualRow.index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}) as <TItem>(
  props: StickyVirtualListProps<TItem> & {
    ref?: React.Ref<StickyVirtualListHandle>
  },
) => React.ReactElement
