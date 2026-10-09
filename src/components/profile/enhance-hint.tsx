import { Alert, Box, Typography } from '@mui/material'
import { Trans, useTranslation } from 'react-i18next'

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
  const orderComponents = Object.fromEntries(
    Object.keys(stageHints).map((key) => [
      key,
      <Box
        key={key}
        component={key === stage ? 'strong' : 'span'}
        sx={
          key === stage
            ? {
                fontWeight: 'bold',
                color: 'primary.contrastText',
                bgcolor: 'primary.main',
                borderRadius: 0.5,
                px: 0.5,
                boxDecorationBreak: 'clone',
              }
            : undefined
        }
      />,
    ]),
  )

  return (
    <Alert severity="info" sx={{ mb: 1.5, flexShrink: 0 }}>
      <Typography variant="body2">{t(stageHints[stage])}</Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        <Trans
          defaults={t('profiles.modals.editor.enhance.order')}
          components={orderComponents}
        />
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {t('profiles.modals.editor.enhance.settingsPriority')}
      </Typography>
    </Alert>
  )
}
