import { Delete as DeleteIcon, RestartAltRounded } from '@mui/icons-material'
import { Box, Button, Divider, List, ListItem, TextField } from '@mui/material'
import { useLockFn, useRequest } from 'ahooks'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, Switch } from '@/components/base'
import { useClash, useDefaultClashConfig } from '@/hooks/use-clash'
import { restartCore } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

// Development origins must never be persisted into production configuration.
const DEV_URLS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'http://localhost:3000',
]

const getFullOrigins = (origins: string[]) => {
  const allOrigins = [...origins, ...DEV_URLS]
  const uniqueOrigins = [...new Set(allOrigins)]
  return uniqueOrigins
}

const filterBaseOriginsForUI = (origins: string[]) => {
  return origins.filter((origin: string) => !DEV_URLS.includes(origin.trim()))
}

const buttonStyle = {
  borderRadius: '8px',
  textTransform: 'none',
  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  transition: 'all 0.3s ease',
  '&:hover': {
    boxShadow: '0 4px 8px rgba(0,0,0,0.15)',
    transform: 'translateY(-1px)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
}

const addButtonStyle = {
  ...buttonStyle,
  backgroundColor: '#4CAF50',
  color: 'white',
  '&:hover': {
    backgroundColor: '#388E3C',
  },
}

const deleteButtonStyle = {
  ...buttonStyle,
  backgroundColor: '#FF5252',
  color: 'white',
  '&:hover': {
    backgroundColor: '#D32F2F',
  },
}

interface ClashHeaderConfigingRef {
  open: () => void
  close: () => void
}

interface AllowOriginItem {
  key: number
  value: string
}

export const HeaderConfiguration = forwardRef<ClashHeaderConfigingRef>(
  (props, ref) => {
    const { t } = useTranslation()
    const { clash, mutateClash, patchClash } = useClash()
    const [open, setOpen] = useState(false)
    const { 'external-controller-cors': defaultCorsConfig } =
      useDefaultClashConfig() ?? {}
    const {
      'allow-private-network': defaultAllowPrivateNetwork,
      'allow-origins': defaultAllowOrigins,
    } = defaultCorsConfig ?? {}

    const lastKeyRef = useRef(0) // 用于生成唯一的key

    const [corsConfig, setCorsConfig] = useState<{
      allowPrivateNetwork: boolean
      allowOrigins: AllowOriginItem[]
    }>(() => {
      const cors = clash?.['external-controller-cors']
      const origins = cors?.['allow-origins'] ?? []
      return {
        allowPrivateNetwork: cors?.['allow-private-network'] ?? true,
        allowOrigins: filterBaseOriginsForUI(origins).map((origin) => {
          lastKeyRef.current += 1
          return { key: lastKeyRef.current, value: origin }
        }),
      }
    })

    const handleCorsConfigChange = (
      key: 'allowPrivateNetwork' | 'allowOrigins',
      value: boolean | AllowOriginItem[],
    ) => {
      setCorsConfig((prev) => ({
        ...prev,
        [key]: value,
      }))
    }

    const handleAddOrigin = () => {
      lastKeyRef.current += 1
      handleCorsConfigChange('allowOrigins', [
        ...corsConfig.allowOrigins,
        { key: lastKeyRef.current, value: '' },
      ])
    }

    const handleUpdateOrigin = (index: number, value: string) => {
      const newOrigins = [...corsConfig.allowOrigins]
      newOrigins[index] = { ...newOrigins[index], value }
      handleCorsConfigChange('allowOrigins', newOrigins)
    }

    const handleDeleteOrigin = (index: number) => {
      const newOrigins = [...corsConfig.allowOrigins]
      newOrigins.splice(index, 1)
      handleCorsConfigChange('allowOrigins', newOrigins)
    }

    const { loading, run: saveConfig } = useRequest(
      async () => {
        const fullOrigins = getFullOrigins(
          corsConfig.allowOrigins.map((origin) => origin.value),
        )

        await patchClash({
          'external-controller-cors': {
            'allow-private-network': corsConfig.allowPrivateNetwork,
            'allow-origins': fullOrigins.filter(
              (origin: string) => origin.trim() !== '',
            ),
          },
        })
        await restartCore()
        await mutateClash()
      },
      {
        manual: true,
        onSuccess: () => {
          setOpen(false)
          showNotice.success('shared.feedback.notifications.common.saveSuccess')
        },
        onError: () => {
          showNotice.error('shared.feedback.notifications.common.saveFailed')
        },
      },
    )

    useImperativeHandle(ref, () => ({
      open: () => {
        const cors = clash?.['external-controller-cors']
        const origins = cors?.['allow-origins'] ?? []
        lastKeyRef.current = 0
        setCorsConfig({
          allowPrivateNetwork: cors?.['allow-private-network'] ?? true,
          allowOrigins: filterBaseOriginsForUI(origins).map((origin) => {
            lastKeyRef.current += 1
            return { key: lastKeyRef.current, value: origin }
          }),
        })
        setOpen(true)
      },
      close: () => setOpen(false),
    }))

    const handleSave = useLockFn(async () => {
      await saveConfig()
    })

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
            {t('settings.sections.externalCors.title')}
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<RestartAltRounded />}
              onClick={() => {
                setCorsConfig({
                  allowPrivateNetwork: defaultAllowPrivateNetwork ?? true,
                  allowOrigins: filterBaseOriginsForUI(
                    defaultAllowOrigins ?? [],
                  ).map((origin) => {
                    lastKeyRef.current += 1
                    return { key: lastKeyRef.current, value: origin }
                  }),
                })
              }}
            >
              {t('shared.actions.resetToDefault')}
            </Button>
          </Box>
        }
        contentSx={{ width: 500 }}
        okBtn={loading ? t('shared.statuses.saving') : t('shared.actions.save')}
        cancelBtn={t('shared.actions.cancel')}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
      >
        <List sx={{ width: '90%', padding: 2 }}>
          <ListItem sx={{ padding: '8px 0' }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
              }}
            >
              <span style={{ fontWeight: 'normal' }}>
                {t('settings.sections.externalCors.fields.allowPrivateNetwork')}
              </span>
              <Switch
                edge="end"
                checked={corsConfig.allowPrivateNetwork}
                onChange={(e) =>
                  handleCorsConfigChange(
                    'allowPrivateNetwork',
                    e.target.checked,
                  )
                }
              />
            </Box>
          </ListItem>

          <Divider sx={{ my: 2 }} />

          <ListItem sx={{ padding: '8px 0' }}>
            <div style={{ width: '100%' }}>
              <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
                {t('settings.sections.externalCors.fields.allowedOrigins')}
              </div>
              {corsConfig.allowOrigins.map(({ key, value: origin }, index) => (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <TextField
                    fullWidth
                    size="small"
                    sx={{ fontSize: 14, marginRight: 2 }}
                    value={origin}
                    onChange={(e) => handleUpdateOrigin(index, e.target.value)}
                    placeholder={t(
                      'settings.sections.externalCors.placeholders.origin',
                    )}
                    slotProps={{ htmlInput: { style: { fontSize: 14 } } }}
                  />
                  <Button
                    variant="contained"
                    color="error"
                    size="small"
                    onClick={() => handleDeleteOrigin(index)}
                    disabled={corsConfig.allowOrigins.length <= 0}
                    sx={deleteButtonStyle}
                  >
                    <DeleteIcon fontSize="small" />
                  </Button>
                </div>
              ))}
              <Button
                variant="contained"
                size="small"
                onClick={handleAddOrigin}
                sx={addButtonStyle}
              >
                {t('settings.sections.externalCors.actions.add')}
              </Button>

              <div
                style={{
                  marginTop: 12,
                  padding: 8,
                  backgroundColor: '#f5f5f5',
                  borderRadius: 4,
                }}
              >
                <div
                  style={{ color: '#666', fontSize: 12, fontStyle: 'italic' }}
                >
                  {t('settings.sections.externalCors.messages.alwaysIncluded', {
                    urls: DEV_URLS.join(', '),
                  })}
                </div>
              </div>
            </div>
          </ListItem>
        </List>
      </BaseDialog>
    )
  },
)
