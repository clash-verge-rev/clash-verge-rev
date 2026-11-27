import { Button } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useRef } from 'react'

import { DialogRef } from '@/components/base'
import { useUpdate } from '@/hooks/use-update'
import { installUpdate, restartApp } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

import { UpdateViewer } from '../setting/mods/update-viewer'

interface Props {
  className?: string
}

export const UpdateButton = (props: Props) => {
  const { className } = props
  const viewerRef = useRef<DialogRef>(null)

  const { updateInfo, stagedVersion } = useUpdate()

  const onRestartToUpdate = useLockFn(async (version: string) => {
    try {
      const outcome = await installUpdate(version, () => {})
      if (outcome === 'installed') {
        await restartApp()
      } else {
        viewerRef.current?.open()
      }
    } catch (err) {
      showNotice.error(err)
    }
  })

  if (!updateInfo?.available) return null

  // The staged installer makes the install near-instant, so the click is the whole action;
  // any other outcome falls back to the dialog.
  const ready = stagedVersion != null && stagedVersion === updateInfo.version

  return (
    <>
      <UpdateViewer ref={viewerRef} />

      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={
          ready
            ? () => onRestartToUpdate(updateInfo.version)
            : () => viewerRef.current?.open()
        }
      >
        {ready ? 'Restart' : 'New'}
      </Button>
    </>
  )
}
