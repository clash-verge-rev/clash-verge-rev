/* eslint-disable @eslint-react/set-state-in-effect */
import { useEffect } from 'foxact/use-abortable-effect'
import { useCallback, useState } from 'react'

import { showNotice } from '@/services/notice-service'

interface UseEditorDocumentOptions {
  open: boolean
  load: () => Promise<string>
}

export const useEditorDocument = ({ open, load }: UseEditorDocumentOptions) => {
  const [value, setValue] = useState('')
  const [savedValue, setSavedValue] = useState('')
  const [loading, setLoading] = useState(true)

  const resetDocumentState = useCallback(() => {
    setValue('')
    setSavedValue('')
    setLoading(true)
  }, [])

  useEffect(
    (signal) => {
      resetDocumentState()

      if (!open) return

      load()
        .then((nextValue) => {
          if (signal.aborted) return

          const normalized = nextValue ?? ''
          setValue(normalized)
          setSavedValue(normalized)
        })
        .catch((error) => {
          if (!signal.aborted) showNotice.error(error)
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false)
        })
    },
    [load, open, resetDocumentState],
  )

  const markSaved = useCallback((nextValue: string) => {
    setSavedValue(nextValue)
  }, [])

  const dirty = value !== savedValue

  return {
    value,
    setValue,
    savedValue,
    loading,
    dirty,
    markSaved,
  }
}
