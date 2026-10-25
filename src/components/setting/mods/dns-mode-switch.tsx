import { Button, ButtonGroup } from '@mui/material'

interface Props {
  value?: string
  onChange?: (value: string) => void
}

export const DnsModeSwitch = (props: Props) => {
  const { value, onChange } = props

  return (
    <ButtonGroup size="small" sx={{ my: '4px' }}>
      <Button
        variant={!value ? 'contained' : 'outlined'}
        onClick={() => onChange?.('')}
        sx={{ textTransform: 'capitalize' }}
      >
        Auto
      </Button>
      <Button
        variant={value === 'disabled' ? 'contained' : 'outlined'}
        onClick={() => onChange?.('disabled')}
        sx={{ textTransform: 'capitalize' }}
      >
        Disabled
      </Button>
      <Button
        variant={value === 'native' ? 'contained' : 'outlined'}
        onClick={() => onChange?.('native')}
        sx={{ textTransform: 'capitalize' }}
      >
        Native
      </Button>
      <Button
        variant={value === 'hijack' ? 'contained' : 'outlined'}
        onClick={() => onChange?.('hijack')}
        sx={{ textTransform: 'capitalize' }}
      >
        Hijack
      </Button>
    </ButtonGroup>
  )
}
