import {
  Button,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useLockFn } from 'ahooks'
import type { ReactNode, Ref } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import {
  createLocalBackup,
  createWebdavBackup,
  importLocalBackup,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { errorDetail, showNotice } from '@/services/notice-service'
import { buildWebdavSignature, setWebdavStatus } from '@/services/webdav-status'

import { useSettingDialog } from '../settings-search-context'

import { AutoBackupSettings } from './auto-backup-settings'
import { BackupHistoryViewer } from './backup-history-viewer'
import { BackupWebdavDialog } from './backup-webdav-dialog'

type BackupSource = 'local' | 'webdav'

export function BackupViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const [open, setOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<BackupSource | null>(null)
  const [localImporting, setLocalImporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historySource, setHistorySource] = useState<BackupSource>('local')
  const [historyPage, setHistoryPage] = useState(0)
  const [webdavDialogOpen, setWebdavDialogOpen] = useState(false)
  const searchParentRef = useRef<'webdav' | 'history' | null>(null)
  const closeSearchDetail = (detail: 'webdav' | 'history') => {
    if (detail === 'webdav') setWebdavDialogOpen(false)
    else setHistoryOpen(false)
    if (searchParentRef.current === detail) {
      searchParentRef.current = null
      setOpen(false)
    }
  }
  const webdavSignature = buildWebdavSignature(verge)

  useSettingDialog(ref, 'backup-viewer', open, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const openHistory = (target: BackupSource) => {
    setHistorySource(target)
    setHistoryPage(0)
    setHistoryOpen(true)
  }

  useSettingDialog(undefined, 'backup-webdav', webdavDialogOpen, () => ({
    open: () => {
      if (!open) searchParentRef.current = 'webdav'
      setOpen(true)
      setWebdavDialogOpen(true)
    },
    close: () => setWebdavDialogOpen(false),
  }))
  useSettingDialog(undefined, 'backup-history', historyOpen, () => ({
    open: () => {
      if (!open) searchParentRef.current = 'history'
      setOpen(true)
      openHistory('local')
    },
    close: () => setHistoryOpen(false),
  }))

  const handleBackup = useLockFn(async (target: BackupSource) => {
    try {
      setBusyAction(target)
      if (target === 'local') {
        await mutate(() => createLocalBackup(), {
          id: 'create-local-backup',
          errorNotice: false,
          successNotice: 'settings.modals.backup.messages.localBackupCreated',
        })
      } else {
        await mutate(() => createWebdavBackup(), {
          id: 'create-webdav-backup',
          errorNotice: false,
          successNotice: 'settings.modals.backup.messages.backupCreated',
          onFulfilled: () => setWebdavStatus(webdavSignature, 'ready'),
        })
      }
    } catch (error) {
      console.error(error)
      showNotice.error(
        target === 'local'
          ? 'settings.modals.backup.messages.localBackupFailed'
          : 'settings.modals.backup.messages.backupFailed',
        target === 'local' ? undefined : { error: errorDetail(error) },
      )
      if (target === 'webdav') {
        setWebdavStatus(webdavSignature, 'failed')
      }
    } finally {
      setBusyAction(null)
    }
  })

  const handleImport = useLockFn(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'Backup File', extensions: ['zip'] }],
    })
    if (!selected || Array.isArray(selected)) return
    try {
      setLocalImporting(true)
      await mutate(() => importLocalBackup(selected), {
        id: 'import-local-backup',
        errorNotice: false,
        successNotice: 'settings.modals.backup.messages.localBackupImported',
      })
      openHistory('local')
    } catch (error) {
      console.error(error)
      showNotice.error(
        'settings.modals.backup.messages.localBackupImportFailed',
        { error: errorDetail(error) },
      )
    } finally {
      setLocalImporting(false)
    }
  })

  const setWebdavBusy = useCallback(
    (loading: boolean) => {
      setBusyAction(loading ? 'webdav' : null)
    },
    [setBusyAction],
  )

  const isLocalBusy = busyAction === 'local' || localImporting

  return (
    <BaseDialog
      open={open}
      title={t('settings.modals.backup.title')}
      contentSx={{ width: { xs: 360, sm: 520 } }}
      disableOk
      cancelBtn={t('shared.actions.close')}
      onCancel={() => setOpen(false)}
      onClose={() => setOpen(false)}
    >
      <span data-settings-dialog="backup-viewer" />
      <Stack spacing={2}>
        <Stack
          spacing={1}
          sx={{
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
            p: 2,
          }}
        >
          <Typography variant="subtitle1">
            {t('settings.modals.backup.auto.title')}
          </Typography>
          <List disablePadding sx={{ '.MuiListItem-root': { px: 0 } }}>
            <AutoBackupSettings />
          </List>
        </Stack>

        <Stack
          spacing={1}
          sx={{
            border: (theme) => `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
            p: 2,
          }}
        >
          <Typography variant="subtitle1">
            {t('settings.modals.backup.manual.title')}
          </Typography>
          <List disablePadding sx={{ '.MuiListItem-root': { px: 0 } }}>
            {(
              [
                {
                  key: 'local' as BackupSource,
                  title: t('settings.modals.backup.tabs.local'),
                  description: t('settings.modals.backup.manual.local'),
                  actions: [
                    <Button
                      data-setting-target="settings.modals.backup.actions.backup"
                      key="backup"
                      variant="contained"
                      size="small"
                      loading={busyAction === 'local'}
                      disabled={localImporting}
                      onClick={() => handleBackup('local')}
                    >
                      {t('settings.modals.backup.actions.backup')}
                    </Button>,
                    <Button
                      data-setting-target="settings.modals.backup.actions.viewHistory"
                      key="history"
                      variant="outlined"
                      size="small"
                      disabled={isLocalBusy}
                      onClick={() => openHistory('local')}
                    >
                      {t('settings.modals.backup.actions.viewHistory')}
                    </Button>,
                    <Button
                      data-setting-target="settings.modals.backup.actions.importBackup"
                      key="import"
                      variant="text"
                      size="small"
                      loading={localImporting}
                      disabled={busyAction === 'local'}
                      onClick={() => handleImport()}
                    >
                      {t('settings.modals.backup.actions.importBackup')}
                    </Button>,
                  ],
                },
                {
                  key: 'webdav' as BackupSource,
                  title: t('settings.modals.backup.tabs.webdav'),
                  description: t('settings.modals.backup.manual.webdav'),
                  actions: [
                    <Button
                      key="backup"
                      variant="contained"
                      size="small"
                      loading={busyAction === 'webdav'}
                      onClick={() => handleBackup('webdav')}
                    >
                      {t('settings.modals.backup.actions.backup')}
                    </Button>,
                    <Button
                      key="history"
                      variant="outlined"
                      size="small"
                      onClick={() => openHistory('webdav')}
                    >
                      {t('settings.modals.backup.actions.viewHistory')}
                    </Button>,
                    <Button
                      key="configure"
                      variant="text"
                      size="small"
                      onClick={() => setWebdavDialogOpen(true)}
                    >
                      {t('settings.modals.backup.manual.configureWebdav')}
                    </Button>,
                  ],
                },
              ] satisfies Array<{
                key: BackupSource
                title: string
                description: string
                actions: ReactNode[]
              }>
            ).map((item, idx) => (
              <ListItem key={item.key} disableGutters divider={idx === 0}>
                <Stack spacing={1} sx={{ width: '100%' }}>
                  <ListItemText
                    primary={item.title}
                    slotProps={{ secondary: { component: 'span' } }}
                    secondary={item.description}
                  />
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    {item.actions}
                  </Stack>
                </Stack>
              </ListItem>
            ))}
          </List>
        </Stack>
      </Stack>

      <BackupHistoryViewer
        open={historyOpen}
        source={historySource}
        page={historyPage}
        onSourceChange={setHistorySource}
        onPageChange={setHistoryPage}
        onClose={() => closeSearchDetail('history')}
      />
      <BackupWebdavDialog
        open={webdavDialogOpen}
        onClose={() => closeSearchDetail('webdav')}
        onBackupSuccess={() => openHistory('webdav')}
        setBusy={setWebdavBusy}
      />
    </BaseDialog>
  )
}
