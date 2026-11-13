import { Button } from '@mui/material'
import { useRef } from 'react'

import { useUpdate } from '@/hooks/use-update'

import {
  UpdateViewer,
  type UpdateViewerRef,
} from '../setting/mods/update-viewer'

interface Props {
  className?: string
}

export const UpdateButton = (props: Props) => {
  const { className } = props
  const viewerRef = useRef<UpdateViewerRef>(null)

  const { updateInfo } = useUpdate()

  if (!updateInfo?.available) return null

  return (
    <>
      <UpdateViewer ref={viewerRef} />

      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={() => viewerRef.current?.open(updateInfo)}
      >
        New
      </Button>
    </>
  )
}
