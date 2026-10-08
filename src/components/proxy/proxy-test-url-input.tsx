import { TextField, type TextFieldProps } from '@mui/material'
import { useState } from 'react'

type Props = Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string
  onCommit: (url: string) => void
}

export const ProxyTestUrlInput = ({ value, ...props }: Props) => (
  <DraftTestUrlInput key={value} value={value} {...props} />
)

const DraftTestUrlInput = ({ value, onCommit, ...props }: Props) => {
  const [draft, setDraft] = useState(value)

  return (
    <TextField
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
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
