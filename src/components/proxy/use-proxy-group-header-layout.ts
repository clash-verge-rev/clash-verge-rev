import { PointerActivationConstraints } from '@dnd-kit/dom'
import { PointerSensor, type DragEndEvent } from '@dnd-kit/react'
import { useCallback } from 'react'

import { useVerge } from '@/hooks/use-verge'

// The header row is itself a click target and hosts buttons and text inputs,
// so a drag may only start once the pointer has travelled; text inputs never
// start one so their selection gestures keep working.
const headerPointerSensor = PointerSensor.configure({
  activationConstraints: (event) =>
    event.pointerType === 'touch'
      ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
      : [new PointerActivationConstraints.Distance({ value: 6 })],
  preventActivation: (event) =>
    event.target instanceof Element &&
    event.target.closest('input, textarea, [contenteditable]') !== null,
})

export const PROXY_GROUP_HEADER_SENSORS = [headerPointerSensor]

export const useProxyGroupHeaderLayout = () => {
  const { verge, mutateVerge, patchVerge } = useVerge()
  const toolsOnLeft = verge?.proxy_group_tools_position === 'left'

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      // Blocks only accept their counterpart, so any drop target means a swap.
      const { operation, canceled } = event
      if (canceled || !operation.source || !operation.target) return

      const position = toolsOnLeft ? 'right' : 'left'
      mutateVerge(
        (prev) =>
          prev ? { ...prev, proxy_group_tools_position: position } : prev,
        false,
      )
      try {
        await patchVerge({ proxy_group_tools_position: position })
      } catch (error) {
        console.error('Failed to save proxy group header layout:', error)
        mutateVerge()
      }
    },
    [toolsOnLeft, mutateVerge, patchVerge],
  )

  return { onDragEnd }
}
