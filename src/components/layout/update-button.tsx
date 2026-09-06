import { Button } from '@mui/material'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { DialogRef } from '@/components/base'
import { useUpdate } from '@/hooks/use-update'

import { UpdateViewer } from '../setting/mods/update-viewer'

interface Props {
  className?: string
}

export const UpdateButton = (props: Props) => {
  const { className } = props
  const { t } = useTranslation()
  const viewerRef = useRef<DialogRef>(null)

  const { updateInfo } = useUpdate()

  if (!updateInfo) return null

  return (
    <>
      <UpdateViewer ref={viewerRef} />

      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={() => viewerRef.current?.open()}
      >
        {t('shared.actions.new')}
      </Button>
    </>
  )
}
