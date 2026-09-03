import { RestartAltRounded } from '@mui/icons-material'
import { Box, Button, Typography } from '@mui/material'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, BaseEmpty, DialogRef } from '@/components/base'
import { useClashInfo } from '@/hooks/use-clash'
import { useVergeConfigField } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'
import { openExternalUrl } from '@/utils/open-external-url'

import { WebUIItem } from './web-ui-item'

export function WebUIViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()

  const { clashInfo } = useClashInfo()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const webUIListField = useVergeConfigField('web_ui_list', [] as string[])

  const webUIEntries = useMemo(() => {
    const counts: Record<string, number> = {}
    return webUIListField.value.map((item, index) => {
      const keyBase = item && item.trim().length > 0 ? item : 'entry'
      const count = counts[keyBase] ?? 0
      counts[keyBase] = count + 1
      return {
        item,
        index,
        key: `${keyBase}-${count}`,
      }
    })
  }, [webUIListField.value])

  const handleAdd = useLockFn(async (value: string) => {
    const newList = [...webUIListField.value, value]
    webUIListField.mutate(newList)
    await webUIListField.patch(newList)
  })

  const handleChange = useLockFn(async (index: number, value?: string) => {
    const newList = [...webUIListField.value]
    newList[index] = value ?? ''
    webUIListField.mutate(newList)
    await webUIListField.patch(newList)
  })

  const handleDelete = useLockFn(async (index: number) => {
    const newList = [...webUIListField.value]
    newList.splice(index, 1)
    webUIListField.mutate(newList)
    await webUIListField.patch(newList)
  })

  const handleOpenUrl = useLockFn(async (value?: string) => {
    if (!value) return
    try {
      let url = value.trim().replaceAll('%host', '127.0.0.1')

      if (url.includes('%port') || url.includes('%secret')) {
        if (!clashInfo) {
          throw new Error(
            t('settings.modals.webUI.errors.clashInfoUnavailable'),
          )
        }
        if (!clashInfo.server?.includes(':')) {
          throw new Error(
            t('settings.modals.webUI.errors.invalidServer', {
              server: clashInfo.server,
            }),
          )
        }

        const port = clashInfo.server
          .slice(clashInfo.server.indexOf(':') + 1)
          .trim()

        url = url.replaceAll('%port', port || '9097')
        url = url.replaceAll(
          '%secret',
          encodeURIComponent(clashInfo.secret || ''),
        )
      }

      await openExternalUrl(url)
    } catch (e: any) {
      showNotice.error('settings.modals.webUI.errors.openFailed', e)
    }
  })

  return (
    <BaseDialog
      open={open}
      title={
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          {t('settings.modals.webUI.title')}
          <Box>
            <Button
              variant="contained"
              size="small"
              disabled={editing}
              onClick={() => setEditing(true)}
              sx={{ marginRight: '8px' }}
            >
              {t('shared.actions.new')}
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<RestartAltRounded />}
              onClick={() => {
                webUIListField.reset()
              }}
            >
              {t('shared.actions.resetToDefault')}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{
        width: 450,
        height: 300,
        pb: 1,
        overflowY: 'auto',
        userSelect: 'text',
      }}
      cancelBtn={t('shared.actions.close')}
      disableOk
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      {!editing && webUIListField.value.length === 0 && (
        <BaseEmpty
          extra={
            <Typography sx={{ mt: 2, fontSize: '12px' }}>
              {t('settings.modals.webUI.messages.placeholderInstruction')}
            </Typography>
          }
        />
      )}

      {webUIEntries.map(({ item, index, key }) => (
        <WebUIItem
          key={key}
          value={item}
          onChange={(v) => handleChange(index, v)}
          onDelete={() => handleDelete(index)}
          onOpenUrl={handleOpenUrl}
        />
      ))}
      {editing && (
        <WebUIItem
          value=""
          onlyEdit
          onChange={(v) => {
            setEditing(false)
            handleAdd(v || '')
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </BaseDialog>
  )
}
