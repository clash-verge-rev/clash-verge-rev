import {
  RestartAltRounded,
  SwitchAccessShortcutRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import { BaseDialog, DialogRef } from '@/components/base'
import { useClash, useClashInfo } from '@/hooks/use-clash'
import { useVerge } from '@/hooks/use-verge'
import {
  cancelClashCoreDownload,
  changeClashCore,
  downloadClashCore,
  isClashCoreInstalled,
  restartCore,
  upgradeClashCore,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import parseTraffic from '@/utils/parse-traffic'

import { useSettingDialog } from '../settings-search-context'

const VALID_CORE = [
  {
    name: 'Mihomo',
    core: 'verge-mihomo',
    chipKey: 'settings.modals.clashCore.variants.release',
  },
  {
    name: 'Mihomo Alpha',
    core: 'verge-mihomo-alpha',
    chipKey: 'settings.modals.clashCore.variants.alpha',
  },
]

export function ClashCoreViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()

  const { verge, mutateVerge } = useVerge()
  const { mutateVersion } = useClash()
  const { invalidateClashConfig } = useClashInfo()

  const [open, setOpen] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [changingCore, setChangingCore] = useState<string | null>(null)
  const [downloadCore, setDownloadCore] = useState('')
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [download, setDownload] = useState({ downloaded: 0, total: 0 })
  const progress =
    download.total <= 0
      ? 0
      : Math.min((download.downloaded / download.total) * 100, 100)

  useSettingDialog(ref, 'clash-core-viewer', open, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }))

  const { clash_core = 'verge-mihomo' } = verge ?? {}

  const switchCore = async (core: string) => {
    try {
      setChangingCore(core)
      void mutate(() => closeAllConnections(), {
        id: 'close-all-connections',
        errorNotice: false,
      })
      const result = await mutate(() => changeClashCore(core), {
        id: 'change-clash-core',
        errorNotice: false,
      })
      if (!result.ok) return
      const errorMsg = result.value

      if (errorMsg) {
        showNotice.error(errorMsg)
        setChangingCore(null)
        return
      }

      mutateVerge()
      await new Promise((resolve) => setTimeout(resolve, 500))
      invalidateClashConfig()
      mutateVersion()
    } catch (err) {
      showNotice.error(err)
    } finally {
      setChangingCore(null)
    }
  }

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === clash_core) return

    let installed: boolean
    try {
      installed = await isClashCoreInstalled(core)
    } catch (err) {
      showNotice.error(err)
      return
    }
    if (installed) {
      await switchCore(core)
    } else {
      setDownloadCore(core)
      setDownloadOpen(true)
    }
  })

  const onDownload = useLockFn(async () => {
    const core = downloadCore

    setDownloading(true)
    setDownload({ downloaded: 0, total: 0 })
    try {
      const result = await mutate(
        () =>
          downloadClashCore(core, (event) => {
            if (event.event === 'Started') {
              setDownload({
                downloaded: 0,
                total: event.data.contentLength ?? 0,
              })
            } else if (event.event === 'Progress') {
              setDownload((prev) => ({
                ...prev,
                downloaded: prev.downloaded + event.data.chunkLength,
              }))
            }
          }),
        { id: 'download-clash-core' },
      )
      // false means the download was cancelled
      if (!result.value) return
      setDownloadOpen(false)
      await switchCore(core)
    } catch {
      // the funnel already notified
    } finally {
      setDownloading(false)
    }
  })

  const onCancelDownload = () => {
    if (downloading) {
      void mutate(() => cancelClashCoreDownload(), {
        id: 'cancel-clash-core-download',
        errorNotice: false,
      })
    }
    setDownloadOpen(false)
  }

  const onRestart = useLockFn(async () => {
    try {
      setRestarting(true)
      await mutate(() => restartCore(), {
        id: 'restart-core',
        successNotice: t(
          'settings.feedback.notifications.clash.restartSuccess',
        ),
      })
      setRestarting(false)
    } catch {
      setRestarting(false)
    }
  })

  const onUpgrade = useLockFn(async () => {
    try {
      setUpgrading(true)
      await mutate(() => upgradeClashCore(), {
        id: 'upgrade-clash-core',
        onFulfilled: (report) => {
          showNotice.success(
            report.upgraded
              ? t('settings.feedback.notifications.clash.versionUpdated')
              : t('settings.feedback.notifications.clash.alreadyLatestVersion'),
          )
        },
      })
    } catch {
      // the funnel already notified
    } finally {
      setUpgrading(false)
    }
  })

  return (
    <BaseDialog
      open={open}
      title={
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          {t('settings.sections.clash.form.fields.clashCore')}
          <Box>
            <Button
              variant="contained"
              size="small"
              startIcon={<SwitchAccessShortcutRounded />}
              loadingPosition="start"
              loading={upgrading}
              disabled={restarting || changingCore !== null}
              sx={{ marginRight: '8px' }}
              data-setting-target="core-upgrade"
              onClick={onUpgrade}
            >
              {t('shared.actions.upgrade')}
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={<RestartAltRounded />}
              loadingPosition="start"
              loading={restarting}
              disabled={upgrading}
              data-setting-target="core-restart"
              onClick={onRestart}
            >
              {t('shared.actions.restart')}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{
        pb: 0,
        width: 400,
        height: 180,
        overflowY: 'auto',
        userSelect: 'text',
        marginTop: '-8px',
      }}
      disableOk
      cancelBtn={t('shared.actions.close')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List
        component="nav"
        data-settings-dialog="clash-core-viewer"
        data-setting-target="core-variants"
        tabIndex={-1}
      >
        {VALID_CORE.map((each) => (
          <ListItemButton
            key={each.core}
            selected={each.core === clash_core}
            onClick={() => onCoreChange(each.core)}
            disabled={changingCore !== null || restarting || upgrading}
          >
            <ListItemText primary={each.name} secondary={`/${each.core}`} />
            {changingCore === each.core ? (
              <CircularProgress size={20} sx={{ mr: 1 }} />
            ) : (
              <Chip label={t(each.chipKey)} size="small" />
            )}
          </ListItemButton>
        ))}
      </List>
      <BaseDialog
        open={downloadOpen}
        title={t('settings.modals.clashCore.download.title')}
        contentSx={{ width: 360 }}
        okBtn={t('settings.modals.clashCore.download.confirm')}
        cancelBtn={t('shared.actions.cancel')}
        loading={downloading}
        onOk={onDownload}
        onCancel={onCancelDownload}
        onClose={downloading ? undefined : onCancelDownload}
      >
        <Typography variant="body2">
          {t('settings.modals.clashCore.download.message', {
            name: VALID_CORE.find((each) => each.core === downloadCore)?.name,
          })}
        </Typography>
        {downloading && (
          <>
            <LinearProgress
              variant={download.total > 0 ? 'determinate' : 'indeterminate'}
              value={progress}
              sx={{ mt: 2 }}
            />
            {download.total > 0 && (
              <Typography
                variant="caption"
                sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}
              >
                {parseTraffic(download.downloaded).join(' ')} /{' '}
                {parseTraffic(download.total).join(' ')}
              </Typography>
            )}
          </>
        )}
      </BaseDialog>
    </BaseDialog>
  )
}
