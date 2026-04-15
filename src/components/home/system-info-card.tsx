import {
  InfoOutlined,
  SettingsOutlined,
  AdminPanelSettingsOutlined,
  DnsOutlined,
  ExtensionOutlined,
} from '@mui/icons-material'
import { Typography, Stack, Divider, Chip, IconButton } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { useServiceInstaller } from '@/hooks/use-service-installer'
import { useSystemState } from '@/hooks/use-system-state'
import {
  useUpdate,
  updateLastCheckTime,
  readLastCheckTime,
} from '@/hooks/use-update'
import { useVerge } from '@/hooks/use-verge'
import { getSystemInfo } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { version as appVersion } from '@root/package.json'

import { EnhancedCard } from './enhanced-card'

export const SystemInfoCard = () => {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()
  const navigate = useNavigate()
  const { isAdminMode, isSidecarMode } = useSystemState()
  const { installServiceAndRestartCore } = useServiceInstaller()

  // 自动检查更新逻辑（lastCheckUpdate 由 useUpdate 统一管理）
  const { checkUpdate: triggerCheckUpdate, lastCheckUpdate } = useUpdate(true)

  const [osInfo, setOsInfo] = useState('')

  const lastCheckUpdateText = useMemo(
    () => (lastCheckUpdate ? new Date(lastCheckUpdate).toLocaleString() : '-'),
    [lastCheckUpdate],
  )

  // 初始化系统信息
  useEffect(() => {
    getSystemInfo()
      .then((info) => {
        const lines = info.split('\n')
        if (lines.length > 0) {
          const sysName = lines[0].split(': ')[1] || ''
          let sysVersion = lines[1].split(': ')[1] || ''

          if (
            sysName &&
            sysVersion.toLowerCase().startsWith(sysName.toLowerCase())
          ) {
            sysVersion = sysVersion.substring(sysName.length).trim()
          }

          setOsInfo(`${sysName} ${sysVersion}`)
        }
      })
      .catch(console.error)
  }, [])

  // 如果启用了自动检查更新但没有记录，设置当前时间并延迟检查
  useEffect(() => {
    if (!verge?.auto_check_update) return
    if (readLastCheckTime() !== null) return

    updateLastCheckTime()
    const timeoutId = window.setTimeout(() => {
      triggerCheckUpdate().catch(console.error)
    }, 5000)
    return () => window.clearTimeout(timeoutId)
  }, [verge?.auto_check_update, triggerCheckUpdate])

  // 导航到设置页面
  const goToSettings = useCallback(() => {
    navigate('/settings')
  }, [navigate])

  // 切换自启动状态
  const toggleAutoLaunch = useCallback(async () => {
    if (!verge) return
    try {
      await patchVerge({ enable_auto_launch: !verge.enable_auto_launch })
    } catch (err) {
      console.error('切换开机自启动状态失败:', err)
    }
  }, [verge, patchVerge])

  // 点击运行模式处理,Sidecar或纯管理员模式允许安装服务
  const handleRunningModeClick = useCallback(() => {
    if (isSidecarMode || (isAdminMode && isSidecarMode)) {
      installServiceAndRestartCore()
    }
  }, [isSidecarMode, isAdminMode, installServiceAndRestartCore])

  // 检查更新
  const onCheckUpdate = useLockFn(async () => {
    try {
      const result = await triggerCheckUpdate()
      const info = result.data
      if (!info?.available) {
        showNotice.success(
          'settings.components.verge.advanced.notifications.latestVersion',
        )
      } else {
        showNotice.info('shared.feedback.notifications.updateAvailable', 2000)
        goToSettings()
      }
    } catch (err) {
      showNotice.error(err)
    }
  })

  // 是否启用自启动
  const autoLaunchEnabled = useMemo(
    () => verge?.enable_auto_launch || false,
    [verge],
  )

  // 运行模式样式
  const runningModeStyle = useMemo(
    () => ({
      // Sidecar或纯管理员模式允许安装服务
      cursor:
        isSidecarMode || (isAdminMode && isSidecarMode) ? 'pointer' : 'default',
      textDecoration:
        isSidecarMode || (isAdminMode && isSidecarMode) ? 'underline' : 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 0.5,
      '&:hover': {
        opacity: isSidecarMode || (isAdminMode && isSidecarMode) ? 0.7 : 1,
      },
    }),
    [isSidecarMode, isAdminMode],
  )

  // 获取模式图标和文本
  const getModeIcon = () => {
    if (isAdminMode) {
      // 判断是否为组合模式（管理员+服务）
      if (!isSidecarMode) {
        return (
          <>
            <AdminPanelSettingsOutlined
              sx={{ color: 'primary.main', fontSize: 16 }}
              titleAccess={t('home.components.systemInfo.badges.adminMode')}
            />
            <DnsOutlined
              sx={{ color: 'success.main', fontSize: 16, ml: 0.5 }}
              titleAccess={t('home.components.systemInfo.badges.serviceMode')}
            />
          </>
        )
      }
      return (
        <AdminPanelSettingsOutlined
          sx={{ color: 'primary.main', fontSize: 16 }}
          titleAccess={t('home.components.systemInfo.badges.adminMode')}
        />
      )
    } else if (isSidecarMode) {
      return (
        <ExtensionOutlined
          sx={{ color: 'info.main', fontSize: 16 }}
          titleAccess={t('home.components.systemInfo.badges.sidecarMode')}
        />
      )
    } else {
      return (
        <DnsOutlined
          sx={{ color: 'success.main', fontSize: 16 }}
          titleAccess={t('home.components.systemInfo.badges.serviceMode')}
        />
      )
    }
  }

  // 获取模式文本
  const getModeText = () => {
    if (isAdminMode) {
      // 判断是否同时处于服务模式
      if (!isSidecarMode) {
        return t('home.components.systemInfo.badges.adminServiceMode')
      }
      return t('home.components.systemInfo.badges.adminMode')
    } else if (isSidecarMode) {
      return t('home.components.systemInfo.badges.sidecarMode')
    } else {
      return t('home.components.systemInfo.badges.serviceMode')
    }
  }

  // 只有当verge存在时才渲染内容
  if (!verge) return null

  return (
    <EnhancedCard
      title={t('home.components.systemInfo.title')}
      icon={<InfoOutlined />}
      iconColor="error"
      action={
        <IconButton
          size="small"
          onClick={goToSettings}
          title={t('home.components.systemInfo.actions.settings')}
        >
          <SettingsOutlined fontSize="small" />
        </IconButton>
      }
    >
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">
            {t('home.components.systemInfo.fields.osInfo')}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            {osInfo}
          </Typography>
        </Stack>
        <Divider />
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('home.components.systemInfo.fields.autoLaunch')}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              size="small"
              label={
                autoLaunchEnabled
                  ? t('shared.statuses.enabled')
                  : t('shared.statuses.disabled')
              }
              color={autoLaunchEnabled ? 'success' : 'default'}
              variant={autoLaunchEnabled ? 'filled' : 'outlined'}
              onClick={toggleAutoLaunch}
              sx={{ cursor: 'pointer' }}
            />
          </Stack>
        </Stack>
        <Divider />
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('home.components.systemInfo.fields.runningMode')}
          </Typography>
          <Typography
            variant="body2"
            onClick={handleRunningModeClick}
            sx={{ ...runningModeStyle, fontWeight: 'medium' }}
          >
            {getModeIcon()}
            {getModeText()}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">
            {t('home.components.systemInfo.fields.lastCheckUpdate')}
          </Typography>
          <Typography
            variant="body2"
            onClick={onCheckUpdate}
            sx={{
              cursor: 'pointer',
              textDecoration: 'underline',
              fontWeight: 'medium',
              '&:hover': { opacity: 0.7 },
            }}
          >
            {lastCheckUpdateText}
          </Typography>
        </Stack>
        <Divider />
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">
            {t('home.components.systemInfo.fields.vergeVersion')}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
            v{appVersion}
          </Typography>
        </Stack>
      </Stack>
    </EnhancedCard>
  )
}
