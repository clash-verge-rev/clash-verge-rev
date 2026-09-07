import { Box, ListItemText, ListItemTextProps } from '@mui/material'
import { ReactNode } from 'react'

export default function SettingListItemText(
  props: { label: string; modified: boolean; extra?: ReactNode } & Omit<
    ListItemTextProps,
    'primary'
  >,
) {
  const { label, modified, extra, ...rest } = props
  return (
    <ListItemText
      {...rest}
      primary={
        <>
          <span>
            {label}
            <Box
              sx={{ display: 'inline-block', minWidth: '1em', fontSize: '1em' }}
            >
              {modified && '*'}
            </Box>
          </span>
          {extra ? extra : null}
        </>
      }
    ></ListItemText>
  )
}
