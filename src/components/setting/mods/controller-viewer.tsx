import { ContentCopy } from '@mui/icons-material'
import {
  Alert,
  Box,
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
import { getExternalController, saveExternalController } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { revalidateQueries } from '@/services/query-client'

export function ControllerViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copySuccess, setCopySuccess] = useState<null | string>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [controller, setController] = useState('')
  const [secret, setSecret] = useState('')
  const [enableController, setEnableController] = useState(false)

  useImperativeHandle(ref, () => ({
    open: async () => {
      try {
        const settings = await getExternalController()
        setController(settings.address)
        setSecret(settings.secret)
        setEnableController(settings.enabled)
        setOpen(true)
      } catch (err) {
        showNotice.error(err)
      }
    },
    close: () => {
      if (!isSaving) setOpen(false)
    },
  }))

  const onSave = useLockFn(async () => {
    if (enableController && !controller.trim()) {
      showNotice.error(
        'settings.sections.externalController.messages.addressRequired',
      )
      return
    }
    if (enableController && !secret.trim()) {
      showNotice.error(
        'settings.sections.externalController.messages.secretRequired',
      )
      return
    }
    try {
      setIsSaving(true)
      await saveExternalController({
        enabled: enableController,
        address: controller,
        secret,
      })
      void revalidateQueries([
        ['getClashInfo'],
        ['getVergeConfig'],
        ['getRuntimeConfig'],
      ])
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

  const onClose = () => {
    if (!isSaving) setOpen(false)
  }

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
      title={t('settings.sections.externalController.title')}
      contentSx={{ width: 400 }}
      okBtn={t('shared.actions.save')}
      cancelBtn={t('shared.actions.cancel')}
      loading={isSaving}
      disableCancel={isSaving}
      onClose={onClose}
      onCancel={onClose}
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
          <ListItemText
            primary={t('settings.sections.externalController.fields.enable')}
          />
          <Switch
            edge="end"
            checked={enableController}
            onChange={(e) => setEnableController(e.target.checked)}
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
                opacity: enableController ? 1 : 0.5,
                pointerEvents: enableController ? 'auto' : 'none',
              }}
              value={controller}
              placeholder={t(
                'settings.sections.externalController.placeholders.address',
              )}
              onChange={(e) => setController(e.target.value)}
              disabled={isSaving || !enableController}
            />
            <Tooltip
              title={t('settings.sections.externalController.tooltips.copy')}
            >
              <IconButton
                size="small"
                onClick={() => handleCopyToClipboard(controller, 'controller')}
                color="primary"
                disabled={isSaving || !enableController}
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
                opacity: enableController ? 1 : 0.5,
                pointerEvents: enableController ? 'auto' : 'none',
              }}
              value={secret}
              placeholder={t(
                'settings.sections.externalController.placeholders.secret',
              )}
              onChange={(e) => setSecret(e.target.value)}
              disabled={isSaving || !enableController}
            />
            <Tooltip
              title={t('settings.sections.externalController.tooltips.copy')}
            >
              <IconButton
                size="small"
                onClick={() => handleCopyToClipboard(secret, 'secret')}
                color="primary"
                disabled={isSaving || !enableController}
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
