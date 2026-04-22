import { Box, Link, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'

import { useWifiDetectionStatus } from '@/hooks/use-wifi-detection-status'
import { openLocationSettings } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

/**
 * Wi-Fi 识别开关的副标题：根据平台 × 开关状态 × 授权状态渲染指引文案。
 * 降级矩阵详见后端 cmd/network.rs 的 get_wifi_detection_status 注释。
 *
 * 排版约束：本组件会被 MUI `ListItemText.secondary` 包装成 `<p>`
 * （`setting-comp.tsx` 透传 secondary），因此所有分支的根元素必须是 inline
 * 元素或 `<p>` 的合法子元素——`<div>` 会触发 HTML validateDOMNesting 警告。
 * 下方多元素分支统一用 `component="span"` + `display: inline-flex`。
 */
export const WifiDetectionStatusLine = () => {
  const { t } = useTranslation()
  const { data: status } = useWifiDetectionStatus()

  if (!status) {
    return null
  }

  if (!status.enabled) {
    return (
      <Typography variant="caption" color="text.secondary">
        {t('settings.sections.clash.form.secondary.wifiDetection.disabled')}
      </Typography>
    )
  }

  if (!status.needsAuthorization) {
    return null
  }

  const handleOpenLocationSettings = () => {
    openLocationSettings().catch((err) => showNotice.error(err))
  }

  // macOS 路径
  if (!status.locationServicesEnabled) {
    return (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          gap: 1,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Typography component="span" variant="caption" color="warning.main">
          {t(
            'settings.sections.clash.form.secondary.wifiDetection.locationDisabled',
          )}
        </Typography>
        <Link
          component="button"
          variant="caption"
          onClick={handleOpenLocationSettings}
        >
          {t('settings.sections.clash.form.actions.openLocationSettings')}
        </Link>
      </Box>
    )
  }

  switch (status.authStatus) {
    case 'authorized':
      return (
        <Typography variant="caption" color="success.main">
          {t('settings.sections.clash.form.secondary.wifiDetection.authorized')}
        </Typography>
      )
    case 'denied':
      return (
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            gap: 1,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Typography component="span" variant="caption" color="warning.main">
            {t(
              'settings.sections.clash.form.secondary.wifiDetection.notAuthorized',
            )}
          </Typography>
          <Link
            component="button"
            variant="caption"
            onClick={handleOpenLocationSettings}
          >
            {t('settings.sections.clash.form.actions.openLocationSettings')}
          </Link>
        </Box>
      )
    case 'restricted':
      return (
        <Typography variant="caption" color="warning.main">
          {t('settings.sections.clash.form.secondary.wifiDetection.restricted')}
        </Typography>
      )
    case 'notApplicable':
      // 非 macOS 的契约值；理论被 `needsAuthorization=false` 短路，
      // 但若契约漂移让 macOS 也返回 notApplicable，不要展示 "waiting" 误导。
      return null
    case 'notDetermined':
    default:
      return (
        <Typography variant="caption" color="text.secondary">
          {t('settings.sections.clash.form.secondary.wifiDetection.waiting')}
        </Typography>
      )
  }
}
