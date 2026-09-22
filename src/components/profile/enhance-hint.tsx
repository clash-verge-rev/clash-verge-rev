import { Alert, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'

const stageHints = {
  globalMerge: 'profiles.modals.editor.enhance.globalMerge',
  globalScript: 'profiles.modals.editor.enhance.globalScript',
  profileMerge: 'profiles.modals.editor.enhance.profileMerge',
  profileScript: 'profiles.modals.editor.enhance.profileScript',
} as const

interface Props {
  stage: keyof typeof stageHints
}

export const EnhanceHint = ({ stage }: Props) => {
  const { t } = useTranslation()

  return (
    <Alert severity="info" sx={{ mb: 1.5, flexShrink: 0 }}>
      <Typography variant="body2">{t(stageHints[stage])}</Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {t('profiles.modals.editor.enhance.order')}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {t('profiles.modals.editor.enhance.settingsPriority')}
      </Typography>
    </Alert>
  )
}
