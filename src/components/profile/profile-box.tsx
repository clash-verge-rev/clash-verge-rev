import { alpha, Box, styled } from '@mui/material'

export const ProfileBox = styled(Box)(
  ({ theme, 'aria-selected': selected }) => {
    const { mode, primary, text } = theme.palette
    const key = `${mode}-${!!selected}`

    const backgroundColor = mode === 'light' ? '#ffffff' : '#282A36'

    const color = {
      'light-true': text.secondary,
      'light-false': text.secondary,
      'dark-true': alpha(text.secondary, 0.65),
      'dark-false': alpha(text.secondary, 0.65),
    }[key]!

    const h2color = {
      'light-true': primary.main,
      'light-false': text.primary,
      'dark-true': primary.main,
      'dark-false': text.primary,
    }[key]!

    const borderLeft = selected
      ? `3px solid ${primary.main}`
      : '3px solid transparent'
    const padding = selected ? '8px 16px 8px 13px' : '8px 16px'

    return {
      position: 'relative',
      display: 'block',
      cursor: 'pointer',
      textAlign: 'left',
      padding,
      boxSizing: 'border-box',
      backgroundColor,
      width: '100%',
      borderLeft,
      borderRadius: '8px',
      color,
      '& h2': { color: h2color },
    }
  },
)
