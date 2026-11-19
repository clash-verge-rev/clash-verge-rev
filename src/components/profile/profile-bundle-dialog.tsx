import { Stack, Typography } from '@mui/material'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { exportProfileBundle, importProfileBundle } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'

interface Props {
  profile?: { uid: string; name: string }
  onClose: () => void
}

export const ProfileBundleDialog = ({ profile, onClose }: Props) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const title = t(profile ? 'profiles.bundle.export' : 'profiles.bundle.import')

  const onConfirm = async () => {
    setLoading(true)
    try {
      const filters = [
        { name: t('profiles.bundle.fileType'), extensions: ['zip'] },
      ]
      if (profile) {
        const destination = await save({
          title,
          defaultPath: 'profile-bundle.zip',
          filters,
        })
        if (!destination) return
        await mutate(() => exportProfileBundle(profile.uid, destination), {
          id: 'export-profile-bundle',
          errorNotice: false,
          successNotice: 'profiles.bundle.exported',
        })
      } else {
        const source = await open({ title, filters, multiple: false })
        if (!source) return
        await mutate(() => importProfileBundle(source), {
          id: 'import-profile-bundle',
          errorNotice: false,
          successNotice: 'profiles.bundle.imported',
        })
      }
      onClose()
    } catch (error) {
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <BaseDialog
      open
      title={title}
      okBtn={title}
      cancelBtn={t('shared.actions.cancel')}
      loading={loading}
      disableCancel={loading}
      onOk={onConfirm}
      onCancel={onClose}
      onClose={loading ? undefined : onClose}
      contentSx={{ maxWidth: 440, userSelect: 'text' }}
    >
      <Stack spacing={1}>
        {profile && <Typography>{profile.name}</Typography>}
        <Typography variant="body2">
          {t('profiles.bundle.credentialsNotice')}
        </Typography>
        {!profile && (
          <Typography variant="body2">
            {t('profiles.bundle.activationNotice')}
          </Typography>
        )}
      </Stack>
    </BaseDialog>
  )
}
