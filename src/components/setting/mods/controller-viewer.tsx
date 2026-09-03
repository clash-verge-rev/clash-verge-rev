import { ContentCopy, RestartAltRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  TextField,
  Tooltip,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useImperativeHandle, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef, Switch } from '@/components/base'
import { useClashConfigField, useClashInfo } from '@/hooks/use-clash'
import { useCachedVergeConfigField } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'

import SettingListItemText from './setting-list-item-text-comp'

export function ControllerViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copySuccess, setCopySuccess] = useState<null | string>(null)
  const [isSaving, setIsSaving] = useState(false)

  const { clashInfo, patchInfo } = useClashInfo()
  const [controller, setController] = useState(clashInfo?.server || '')
  const [secret, setSecret] = useState(clashInfo?.secret || '')
  const externalControllerField = useClashConfigField(
    'external-controller',
    controller,
  )
  const secretField = useClashConfigField('secret', secret)
  const enableControllerCachedField = useCachedVergeConfigField(
    'enable_external_controller',
    false,
  )

  // 对话框打开时初始化配置
  useImperativeHandle(ref, () => ({
    open: async () => {
      setOpen(true)
      setController(clashInfo?.server || '')
      setSecret(clashInfo?.secret || '')
      enableControllerCachedField.refetch()
    },
    close: () => setOpen(false),
  }))

  // 保存配置
  const onSave = useLockFn(async () => {
    try {
      setIsSaving(true)

      // 先保存 enable_external_controller 设置
      enableControllerCachedField.save()

      // 如果启用了外部控制器，则保存控制器地址和密钥
      if (enableControllerCachedField.value) {
        if (!controller.trim()) {
          showNotice.error(
            'settings.sections.externalController.messages.addressRequired',
          )
          return
        }

        if (!secret.trim()) {
          showNotice.error(
            'settings.sections.externalController.messages.secretRequired',
          )
          return
        }

        await patchInfo({ 'external-controller': controller, secret })
      } else {
        // 如果禁用了外部控制器，则清空控制器地址
        await patchInfo({ 'external-controller': '' })
      }

      showNotice.success('shared.feedback.notifications.common.saveSuccess')
      setOpen(false)
    } catch (err) {
      showNotice.error(
        'shared.feedback.notifications.common.saveFailed',
        err,
        4000,
      )
    } finally {
      setIsSaving(false)
    }
  })

  // 复制到剪贴板
  const handleCopyToClipboard = useLockFn(
    async (text: string, type: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopySuccess(type)
        setTimeout(() => setCopySuccess(null))
      } catch (err) {
        console.warn('[ControllerViewer] copy to clipboard failed:', err)
        showNotice.error(
          'settings.sections.externalController.messages.copyFailed',
        )
      }
    },
  )

  return (
    <BaseDialog
      open={open}
      title={
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {t('settings.sections.externalController.title')}
          <Button
            variant="outlined"
            size="small"
            color="warning"
            startIcon={<RestartAltRounded />}
            onClick={() => {
              enableControllerCachedField.reset()
              setController(externalControllerField.defaultValue)
              setSecret(secretField.defaultValue)
            }}
          >
            {t('shared.actions.resetToDefault')}
          </Button>
        </Box>
      }
      contentSx={{ width: 400 }}
      okBtn={
        isSaving ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} color="inherit" />
            {t('shared.statuses.saving')}
          </Box>
        ) : (
          t('shared.actions.save')
        )
      }
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem
          sx={{
            padding: '5px 2px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <SettingListItemText
            label={t('settings.sections.externalController.fields.enable')}
            modified={enableControllerCachedField.modified}
          />
          <Switch
            edge="end"
            checked={enableControllerCachedField.value}
            onChange={(e) => enableControllerCachedField.set(e.target.checked)}
            disabled={isSaving}
          />
        </ListItem>

        <ListItem
          sx={{
            padding: '5px 2px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <ListItemText
            primary={t('settings.sections.externalController.fields.address')}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              size="small"
              sx={{
                width: 175,
                opacity: enableControllerCachedField.value ? 1 : 0.5,
                pointerEvents: enableControllerCachedField.value
                  ? 'auto'
                  : 'none',
              }}
              value={controller}
              placeholder={t(
                'settings.sections.externalController.placeholders.address',
              )}
              onChange={(e) => setController(e.target.value)}
              disabled={isSaving || !enableControllerCachedField.value}
            />
            <Tooltip
              title={t('settings.sections.externalController.tooltips.copy')}
            >
              <IconButton
                size="small"
                onClick={() => handleCopyToClipboard(controller, 'controller')}
                color="primary"
                disabled={isSaving || !enableControllerCachedField.value}
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </ListItem>

        <ListItem
          sx={{
            padding: '5px 2px',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <ListItemText
            primary={t('settings.sections.externalController.fields.secret')}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              size="small"
              sx={{
                width: 175,
                opacity: enableControllerCachedField.value ? 1 : 0.5,
                pointerEvents: enableControllerCachedField.value
                  ? 'auto'
                  : 'none',
              }}
              value={secret}
              placeholder={t(
                'settings.sections.externalController.placeholders.secret',
              )}
              onChange={(e) => setSecret(e.target.value)}
              disabled={isSaving || !enableControllerCachedField.value}
            />
            <Tooltip
              title={t('settings.sections.externalController.tooltips.copy')}
            >
              <IconButton
                size="small"
                onClick={() => handleCopyToClipboard(secret, 'secret')}
                color="primary"
                disabled={isSaving || !enableControllerCachedField.value}
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </ListItem>
      </List>

      <Snackbar
        open={copySuccess !== null}
        autoHideDuration={2000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success">
          {copySuccess === 'controller'
            ? t(
                'settings.sections.externalController.messages.controllerCopied',
              )
            : t('settings.sections.externalController.messages.secretCopied')}
        </Alert>
      </Snackbar>
    </BaseDialog>
  )
}
