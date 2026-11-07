import {
  createContext,
  use,
  useEffect,
  useImperativeHandle,
  type Ref,
} from 'react'

import type { DialogRef } from '@/components/base'

export interface SearchDialog {
  id: string
  open: () => void
  isOpen: boolean
}
export const SettingsSearchContext = createContext<Set<SearchDialog> | null>(
  null,
)

export function useSettingDialog(
  ref: Ref<DialogRef> | undefined,
  id: string,
  open: boolean,
  create: () => DialogRef,
) {
  useImperativeHandle(ref, create)
  const registry = use(SettingsSearchContext)
  useEffect(() => {
    if (!registry) return
    const handle = {
      id,
      isOpen: open,
      open: () => {
        if (!open) create().open()
      },
    }
    registry.add(handle)
    return () => {
      registry.delete(handle)
    }
  })
}
