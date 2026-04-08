import { useVirtualizer } from '@tanstack/react-virtual'
import {
  CSSProperties,
  forwardRef,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

export interface VirtualListHandle {
  scrollToIndex: (
    index: number,
    options?: {
      align?: 'start' | 'center' | 'end' | 'auto'
      behavior?: ScrollBehavior
    },
  ) => void
  scrollTo: (options: ScrollToOptions) => void
}

interface VirtualListProps {
  count: number
  estimateSize: number
  overscan?: number
  getItemKey?: (index: number) => React.Key
  renderItem: (index: number) => ReactNode
  style?: CSSProperties
  footer?: number
  onScroll?: (e: Event) => void
}

export const VirtualList = forwardRef<VirtualListHandle, VirtualListProps>(
  (
    {
      count,
      estimateSize,
      overscan = 5,
      getItemKey,
      renderItem,
      style,
      footer,
      onScroll,
    },
    ref,
  ) => {
    const parentRef = useRef<HTMLDivElement>(null)
    const virtualizer = useVirtualizer({
      count,
      getScrollElement: () => parentRef.current,
      estimateSize: () => estimateSize,
      overscan,
      getItemKey,
    })

    useEffect(() => {
      const el = parentRef.current
      if (!el || !onScroll) return
      el.addEventListener('scroll', onScroll, { passive: true })
      return () => el.removeEventListener('scroll', onScroll)
    }, [onScroll])

    useImperativeHandle(ref, () => ({
      scrollToIndex: (index, options) =>
        virtualizer.scrollToIndex(index, options),
      scrollTo: (options) => parentRef.current?.scrollTo(options),
    }))

    return (
      <div ref={parentRef} style={{ ...style, overflow: 'auto' }}>
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((vi) => (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {renderItem(vi.index)}
            </div>
          ))}
          {footer != null && <div style={{ height: footer }} />}
        </div>
      </div>
    )
  },
)

VirtualList.displayName = 'VirtualList'
