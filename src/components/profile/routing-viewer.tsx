import { AddRounded, DeleteOutlineRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog } from '@/components/base'
import { errorDetail, showNotice } from '@/services/notice-service'

type RouteDraft = Omit<
  IProfileRoute,
  'domains' | 'exact_domains' | 'regions' | 'port' | 'node'
> & {
  domains: string
  exact_domains: string
  regions: string
  port: string
  node: string
}

interface Props {
  profiles: IProfilesConfig
  onClose: () => void
  onSave: (value: Partial<IProfilesConfig>) => Promise<ValidationOutcome>
}

const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const toDraft = (route: IProfileRoute): RouteDraft => ({
  ...route,
  domains: route.domains.join('\n'),
  exact_domains: route.exact_domains.join('\n'),
  regions: route.regions.join('\n'),
  port: route.port?.toString() ?? '',
  node: route.node ?? '',
})

export function RoutingViewer({ profiles, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const sourceLabelId = useId()
  const policyLabelId = useId()
  const [routes, setRoutes] = useState<RouteDraft[]>(() =>
    (profiles.routing ?? []).map(toDraft),
  )
  const [selected, setSelected] = useState<string | null>(
    profiles.routing?.[0]?.profile ?? null,
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const sources = (profiles.items ?? []).filter(
    (item) => item.uid && (item.type === 'remote' || item.type === 'local'),
  )
  const available = sources.filter(
    (item) => !routes.some((route) => route.profile === item.uid),
  )
  const active = routes.find((route) => route.profile === selected)
  const main = sources.find((item) => item.uid === profiles.current)

  const update = (value: Partial<RouteDraft>) => {
    setRoutes((current) =>
      current.map((route) =>
        route.profile === selected ? { ...route, ...value } : route,
      ),
    )
    setMessage('')
  }

  const add = () => {
    const source = available[0]
    if (!source) return
    setRoutes((current) => [
      ...current,
      {
        profile: source.uid,
        enabled: true,
        domains: '',
        exact_domains: '',
        port: '',
        policy: 'manual',
        node: '',
        regions: '',
      },
    ])
    setSelected(source.uid)
    setMessage('')
  }

  const remove = () => {
    setRoutes((current) =>
      current.filter((route) => route.profile !== selected),
    )
    setSelected(
      routes.find((route) => route.profile !== selected)?.profile ?? null,
    )
    setMessage('')
  }

  const save = async () => {
    const next: IProfileRoute[] = []
    for (const route of routes) {
      const portText = route.port.trim()
      const port = portText ? Number(portText) : undefined
      if (
        portText &&
        (!/^\d+$/.test(portText) ||
          !Number.isInteger(port) ||
          port! < 1 ||
          port! > 65535)
      ) {
        setSelected(route.profile)
        setMessage(t('profiles.modals.routing.errors.port'))
        return
      }
      const domains = lines(route.domains)
      const exactDomains = lines(route.exact_domains)
      if (route.enabled && !domains.length && !exactDomains.length && !port) {
        setSelected(route.profile)
        setMessage(t('profiles.modals.routing.errors.targetRequired'))
        return
      }
      if (route.enabled && route.policy === 'fixed' && !route.node.trim()) {
        setSelected(route.profile)
        setMessage(t('profiles.modals.routing.errors.nodeRequired'))
        return
      }
      next.push({
        profile: route.profile,
        enabled: route.enabled,
        domains,
        exact_domains: exactDomains,
        ...(port ? { port } : {}),
        policy: route.policy,
        ...(route.node.trim() ? { node: route.node } : {}),
        regions: lines(route.regions),
      })
    }

    setSaving(true)
    setMessage('')
    try {
      const outcome = await onSave({ routing: next })
      if (outcome.status === 'valid') {
        showNotice.success('profiles.modals.routing.saved')
        onClose()
      } else if (outcome.status === 'invalid') {
        setMessage(outcome.message)
      } else {
        setMessage(t('profiles.modals.routing.errors.busy'))
      }
    } catch (error) {
      setMessage(errorDetail(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BaseDialog
      open
      title={t('profiles.modals.routing.title')}
      contentSx={{
        width: 520,
        maxWidth: 'calc(100vw - 112px)',
        minHeight: 430,
      }}
      okBtn={t('profiles.modals.routing.saveApply')}
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => !saving && onClose()}
      onCancel={() => !saving && onClose()}
      onOk={() => void save()}
      loading={saving}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('profiles.modals.routing.mainProfile', {
          name: main?.name || t('profiles.modals.routing.noMainProfile'),
        })}
      </Typography>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ minHeight: 350 }}
      >
        <Box sx={{ width: { sm: 215 }, flexShrink: 0 }}>
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 1,
            }}
          >
            <Typography variant="subtitle2">
              {t('profiles.modals.routing.bindings')}
            </Typography>
            <Button
              size="small"
              startIcon={<AddRounded />}
              onClick={add}
              disabled={!available.length || saving}
            >
              {t('profiles.modals.routing.addBinding')}
            </Button>
          </Stack>
          {routes.length ? (
            <List
              dense
              disablePadding
              sx={{ maxHeight: 330, overflowY: 'auto' }}
            >
              {routes.map((route) => {
                const source = sources.find(
                  (item) => item.uid === route.profile,
                )
                return (
                  <ListItemButton
                    key={route.profile}
                    selected={selected === route.profile}
                    onClick={() => setSelected(route.profile)}
                    disabled={saving}
                    sx={{ borderRadius: 1, mb: 0.5 }}
                  >
                    <ListItemText
                      primary={source?.name || route.profile}
                      secondary={`${t(`profiles.modals.routing.source.${source?.type === 'local' ? 'local' : source ? 'remote' : 'missing'}`)} · ${t(`profiles.modals.routing.status.${route.enabled ? 'enabled' : 'disabled'}`)}`}
                      slotProps={{
                        primary: { noWrap: true },
                        secondary: { noWrap: true },
                      }}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('profiles.modals.routing.empty')}
            </Typography>
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {active ? (
            <Stack
              spacing={1.5}
              sx={{
                '& .MuiFormHelperText-root:not(.Mui-error):not(.Mui-disabled)':
                  {
                    color: 'text.primary',
                  },
                '& .MuiInputLabel-root:not(.Mui-focused):not(.Mui-error):not(.Mui-disabled)':
                  {
                    color: 'text.primary',
                  },
              }}
            >
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography variant="subtitle2">
                  {t('profiles.modals.routing.binding')}
                </Typography>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineRounded />}
                  onClick={remove}
                  disabled={saving}
                >
                  {t('shared.actions.delete')}
                </Button>
              </Stack>
              <FormControl fullWidth size="small">
                <InputLabel id={sourceLabelId}>
                  {t('profiles.modals.routing.sourceProfile')}
                </InputLabel>
                <Select
                  labelId={sourceLabelId}
                  id={`${sourceLabelId}-select`}
                  value={active.profile}
                  label={t('profiles.modals.routing.sourceProfile')}
                  onChange={(event) => {
                    const profile = event.target.value
                    setRoutes((current) =>
                      current.map((route) =>
                        route.profile === selected
                          ? { ...route, profile }
                          : route,
                      ),
                    )
                    setSelected(profile)
                  }}
                  disabled={saving}
                >
                  {!sources.some((item) => item.uid === active.profile) && (
                    <MenuItem value={active.profile} disabled>
                      {active.profile} (
                      {t('profiles.modals.routing.source.missing')})
                    </MenuItem>
                  )}
                  {sources.map((item) => (
                    <MenuItem
                      key={item.uid}
                      value={item.uid}
                      disabled={
                        item.uid !== active.profile &&
                        routes.some((route) => route.profile === item.uid)
                      }
                    >
                      {item.name || item.uid} (
                      {t(
                        `profiles.modals.routing.source.${item.type === 'local' ? 'local' : 'remote'}`,
                      )}
                      )
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Switch
                    checked={active.enabled}
                    onChange={(_, enabled) => update({ enabled })}
                    disabled={saving}
                  />
                }
                label={t('profiles.modals.routing.enabled')}
              />
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={2}
                label={t('profiles.modals.routing.domains')}
                helperText={t('profiles.modals.routing.domainsHelp')}
                value={active.domains}
                onChange={(event) => update({ domains: event.target.value })}
                disabled={saving}
              />
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={2}
                label={t('profiles.modals.routing.exactDomains')}
                helperText={t('profiles.modals.routing.exactDomainsHelp')}
                value={active.exact_domains}
                onChange={(event) =>
                  update({ exact_domains: event.target.value })
                }
                disabled={saving}
              />
              <TextField
                fullWidth
                size="small"
                type="number"
                label={t('profiles.modals.routing.port')}
                helperText={t('profiles.modals.routing.portHelp')}
                value={active.port}
                onChange={(event) => update({ port: event.target.value })}
                slotProps={{ htmlInput: { min: 1, max: 65535, step: 1 } }}
                disabled={saving}
              />
              <FormControl fullWidth size="small">
                <InputLabel id={policyLabelId}>
                  {t('profiles.modals.routing.policy')}
                </InputLabel>
                <Select
                  labelId={policyLabelId}
                  id={`${policyLabelId}-select`}
                  value={active.policy}
                  label={t('profiles.modals.routing.policy')}
                  onChange={(event) =>
                    update({
                      policy: event.target.value as IProfileRoute['policy'],
                    })
                  }
                  disabled={saving}
                >
                  {(['manual', 'fixed', 'auto', 'fallback'] as const).map(
                    (policy) => (
                      <MenuItem key={policy} value={policy}>
                        {t(`profiles.modals.routing.policies.${policy}`)}
                      </MenuItem>
                    ),
                  )}
                </Select>
              </FormControl>
              {active.policy === 'fixed' && (
                <TextField
                  fullWidth
                  size="small"
                  label={t('profiles.modals.routing.node')}
                  helperText={t('profiles.modals.routing.nodeHelp')}
                  value={active.node}
                  onChange={(event) => update({ node: event.target.value })}
                  disabled={saving}
                />
              )}
              {(active.policy === 'auto' || active.policy === 'fallback') && (
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  minRows={2}
                  label={t('profiles.modals.routing.regions')}
                  helperText={t('profiles.modals.routing.regionsHelp')}
                  value={active.regions}
                  onChange={(event) => update({ regions: event.target.value })}
                  disabled={saving}
                />
              )}
            </Stack>
          ) : (
            <Stack spacing={1} sx={{ pt: 3, alignItems: 'flex-start' }}>
              <Chip
                size="small"
                label={t('profiles.modals.routing.defaultTraffic')}
              />
              <Typography variant="body2" color="text.secondary">
                {t('profiles.modals.routing.emptyDetail')}
              </Typography>
            </Stack>
          )}
        </Box>
      </Stack>
      {message && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {message}
        </Alert>
      )}
    </BaseDialog>
  )
}
