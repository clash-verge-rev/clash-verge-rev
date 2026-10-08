import { TextField, type TextFieldProps } from '@mui/material'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { useProfiles } from '@/hooks/use-profiles'

type Props = Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string
  onCommit: (url: string) => void
}

export const ProxyTestUrlInput = ({ value, name, ...props }: Props) => {
  const { profiles } = useProfiles()
  return (
    <DraftTestUrlInput
      key={JSON.stringify([profiles?.current, name])}
      name={name}
      value={value}
      {...props}
    />
  )
}

const DraftTestUrlInput = ({ value, onCommit, ...props }: Props) => {
  const [draft, setDraft] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const commitOnUnmount = useEffectEvent(() => {
    if (pendingRef.current !== null && pendingRef.current !== value)
      onCommit(pendingRef.current)
  })
  useEffect(() => () => commitOnUnmount(), [])

  return (
    <TextField
      {...props}
      value={draft ?? value}
      onChange={(event) => {
        pendingRef.current = event.target.value
        setDraft(event.target.value)
      }}
      onBlur={() => {
        const next = pendingRef.current
        pendingRef.current = null
        setDraft(null)
        if (next !== null && next !== value) onCommit(next)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          const input = event.target as HTMLInputElement
          input.blur()
        }
      }}
    />
  )
}
