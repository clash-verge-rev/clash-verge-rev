import { Box, type BoxProps } from '@mui/material'

export const CaptureCard = ({ children, ...props }: BoxProps) => (
  <Box
    sx={{
      p: 2,
      borderRadius: 2,
      border: '1px solid',
      borderColor: 'divider',
    }}
    {...props}
  >
    {children}
  </Box>
)
