import { AddRounded, ContentCopy, DeleteRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  TextField,
  Tooltip,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef, Switch } from '@/components/base'
import { useClash, useClashInfo } from '@/hooks/use-clash'
import { useVerge } from '@/hooks/use-verge'
import { restartCore } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const DEV_URLS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:3000',
]

const getFullOrigins = (origins: string[]) => {
  return [...new Set([...origins, ...DEV_URLS])]
}

const filterBaseOriginsForUI = (origins: string[]) => {
  return origins.filter((origin) => !DEV_URLS.includes(origin.trim()))
}

const normalizeOrigins = (origins: string[]) => {
  return origins.map((origin) => origin.trim()).filter(Boolean)
}

const sameOrigins = (left: string[], right: string[]) => {
  const leftSet = new Set(normalizeOrigins(left))
  const rightSet = new Set(normalizeOrigins(right))
  if (leftSet.size !== rightSet.size) return false
  return [...leftSet].every((origin) => rightSet.has(origin))
}

interface AllowOriginItem {
  key: number
  value: string
}

export function ControllerViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copySuccess, setCopySuccess] = useState<null | string>(null)
  const [isSaving, setIsSaving] = useState(false)
  const lastOriginKeyRef = useRef(0)

  const { clash, mutateClash, patchClash } = useClash()
  const { clashInfo, patchInfo } = useClashInfo()
  const { verge, patchVerge } = useVerge()
  const [controller, setController] = useState(clashInfo?.server || '')
  const [secret, setSecret] = useState(clashInfo?.secret || '')
  const [enableController, setEnableController] = useState(
    verge?.enable_external_controller ?? false,
  )
  const [corsConfig, setCorsConfig] = useState<{
    allowPrivateNetwork: boolean
    allowOrigins: AllowOriginItem[]
  }>(() => {
    const cors = clash?.['external-controller-cors']
    const origins = cors?.['allow-origins'] ?? []
    return {
      allowPrivateNetwork: cors?.['allow-private-network'] ?? true,
      allowOrigins: filterBaseOriginsForUI(origins).map((origin) => {
        lastOriginKeyRef.current += 1
        return { key: lastOriginKeyRef.current, value: origin }
      }),
    }
  })

  const resetCorsConfig = () => {
    const cors = clash?.['external-controller-cors']
    const origins = cors?.['allow-origins'] ?? []
    lastOriginKeyRef.current = 0
    setCorsConfig({
      allowPrivateNetwork: cors?.['allow-private-network'] ?? true,
      allowOrigins: filterBaseOriginsForUI(origins).map((origin) => {
        lastOriginKeyRef.current += 1
        return { key: lastOriginKeyRef.current, value: origin }
      }),
    })
  }

  // 对话框打开时初始化配置
  useImperativeHandle(ref, () => ({
    open: async () => {
      setOpen(true)
      setController(clashInfo?.server || '')
      setSecret(clashInfo?.secret || '')
      setEnableController(verge?.enable_external_controller ?? false)
      resetCorsConfig()
    },
    close: () => setOpen(false),
  }))

  // 保存配置
  const onSave = useLockFn(async () => {
    try {
      setIsSaving(true)

      const trimmedController = controller.trim()
      const trimmedSecret = secret.trim()

      // 先保存 enable_external_controller 设置
      await patchVerge({ enable_external_controller: enableController })

      // 如果启用了外部控制器，则保存控制器地址和密钥
      if (enableController) {
        if (!trimmedController) {
          showNotice.error(
            'settings.sections.externalController.messages.addressRequired',
          )
          return
        }

        await patchInfo({
          'external-controller': trimmedController,
          secret: trimmedSecret,
        })
      } else {
        // 如果禁用了外部控制器，则清空控制器地址
        await patchInfo({ 'external-controller': '' })
      }

      const fullOrigins = getFullOrigins(
        corsConfig.allowOrigins.map((origin) => origin.value),
      )
      const nextCors = {
        'allow-private-network': corsConfig.allowPrivateNetwork,
        'allow-origins': normalizeOrigins(fullOrigins),
      }
      const currentCors = clash?.['external-controller-cors']
      const corsChanged =
        (currentCors?.['allow-private-network'] ?? true) !==
          nextCors['allow-private-network'] ||
        !sameOrigins(
          currentCors?.['allow-origins'] ?? [],
          nextCors['allow-origins'],
        )

      if (corsChanged) {
        await patchClash({ 'external-controller-cors': nextCors })
        await restartCore()
        await mutateClash()
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

  const handleAddOrigin = () => {
    lastOriginKeyRef.current += 1
    setCorsConfig((prev) => ({
      ...prev,
      allowOrigins: [
        ...prev.allowOrigins,
        { key: lastOriginKeyRef.current, value: '' },
      ],
    }))
  }

  const handleUpdateOrigin = (index: number, value: string) => {
    setCorsConfig((prev) => {
      const allowOrigins = [...prev.allowOrigins]
      allowOrigins[index] = { ...allowOrigins[index], value }
      return { ...prev, allowOrigins }
    })
  }

  const handleDeleteOrigin = (index: number) => {
    setCorsConfig((prev) => {
      const allowOrigins = [...prev.allowOrigins]
      allowOrigins.splice(index, 1)
      return { ...prev, allowOrigins }
    })
  }

  return (
    <BaseDialog
      open={open}
      title={t('settings.sections.clash.form.fields.external')}
      contentSx={{ width: 520 }}
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
      <List sx={{ pt: 0 }}>
        <ListItem sx={{ px: 0, py: 0.5 }}>
          <ListItemText
            primary={t('settings.sections.externalController.title')}
            slotProps={{ primary: { sx: { fontWeight: 700 } } }}
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
                width: 240,
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
                disabled={isSaving || !enableController || !controller.trim()}
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
                width: 240,
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
                disabled={isSaving || !enableController || !secret.trim()}
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </ListItem>

        <Divider sx={{ my: 1.5 }} />

        <ListItem sx={{ px: 0, py: 0.5 }}>
          <ListItemText
            primary={t('settings.sections.externalCors.title')}
            secondary={t(
              'settings.sections.externalCors.messages.alwaysIncluded',
              {
                urls: DEV_URLS.join(', '),
              },
            )}
            slotProps={{
              primary: { sx: { fontWeight: 700 } },
              secondary: { sx: { mt: 0.5 } },
            }}
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
            primary={t(
              'settings.sections.externalCors.fields.allowPrivateNetwork',
            )}
          />
          <Switch
            edge="end"
            checked={corsConfig.allowPrivateNetwork}
            onChange={(e) =>
              setCorsConfig((prev) => ({
                ...prev,
                allowPrivateNetwork: e.target.checked,
              }))
            }
            disabled={isSaving}
          />
        </ListItem>

        <ListItem
          sx={{
            px: 0,
            py: 0.5,
            display: 'block',
          }}
        >
          <ListItemText
            primary={t('settings.sections.externalCors.fields.allowedOrigins')}
          />
          <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
            {corsConfig.allowOrigins.map(({ key, value: origin }, index) => (
              <Box
                key={key}
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <TextField
                  fullWidth
                  size="small"
                  value={origin}
                  placeholder={t(
                    'settings.sections.externalCors.placeholders.origin',
                  )}
                  onChange={(e) => handleUpdateOrigin(index, e.target.value)}
                  disabled={isSaving}
                />
                <IconButton
                  size="small"
                  color="error"
                  title={t('shared.actions.delete')}
                  onClick={() => handleDeleteOrigin(index)}
                  disabled={isSaving}
                >
                  <DeleteRounded fontSize="small" />
                </IconButton>
              </Box>
            ))}
            <Box>
              <Button
                size="small"
                startIcon={<AddRounded />}
                onClick={handleAddOrigin}
                disabled={isSaving}
              >
                {t('settings.sections.externalCors.actions.add')}
              </Button>
            </Box>
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
