import {
  ArrowBackRounded,
  ArrowForwardRounded,
  CheckRounded,
  SaveRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Radio,
  TextField,
  Typography,
  alpha,
  styled,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type ManualGroupType = IProxyGroupConfig['type']
type GroupPlacement = 'prepend' | 'append'
type GroupStep = 0 | 1 | 2

interface ManualGroupViewerProps {
  open: boolean
  existingNames: string[]
  policyOptions: string[]
  proxyOptions?: string[]
  groupOptions?: string[]
  mode?: 'add' | 'edit'
  initialGroup?: IProxyGroupConfig | null
  onClose: () => void
  onAdd: (group: IProxyGroupConfig, placement: GroupPlacement) => void
  onSave?: (group: IProxyGroupConfig) => void
}

interface ManualGroupForm {
  type: ManualGroupType
  name: string
  proxies: string[]
  use: string[]
  includeAll: boolean
  includeAllProxies: boolean
  includeAllProviders: boolean
  url: string
  interval: string
  timeout: string
  tolerance: string
  strategy: string
  filter: string
  excludeFilter: string
  icon: string
  hidden: boolean
  lazy: boolean
  disableUdp: boolean
}

type FormErrors = Partial<Record<keyof ManualGroupForm, string>>

const TR_PREFIX = 'profiles.modals.manualGroup'
const EMPTY_POLICY_OPTIONS: string[] = []
const BUILTIN_POLICY_OPTIONS = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
]

type PolicyOptionGroup = {
  key: 'builtin' | 'proxy' | 'group' | 'other'
  label: string
  options: string[]
}

const GROUP_TYPES: Array<{
  value: ManualGroupType
  titleKey: string
  descKey: string
}> = [
  {
    value: 'select',
    titleKey: 'types.select.title',
    descKey: 'types.select.description',
  },
  {
    value: 'url-test',
    titleKey: 'types.urlTest.title',
    descKey: 'types.urlTest.description',
  },
  {
    value: 'fallback',
    titleKey: 'types.fallback.title',
    descKey: 'types.fallback.description',
  },
  {
    value: 'load-balance',
    titleKey: 'types.loadBalance.title',
    descKey: 'types.loadBalance.description',
  },
  {
    value: 'relay',
    titleKey: 'types.relay.title',
    descKey: 'types.relay.description',
  },
]

const initialForm: ManualGroupForm = {
  type: 'select',
  name: '',
  proxies: [],
  use: [],
  includeAll: false,
  includeAllProxies: false,
  includeAllProviders: false,
  url: 'http://cp.cloudflare.com/generate_204',
  interval: '300',
  timeout: '5000',
  tolerance: '',
  strategy: '',
  filter: '',
  excludeFilter: '',
  icon: '',
  hidden: false,
  lazy: true,
  disableUdp: false,
}

const cloneInitialForm = (): ManualGroupForm => ({ ...initialForm })

const toText = (value: unknown) => {
  if (value === undefined || value === null) return ''
  return String(value)
}

const toNumber = (value: string) => {
  if (!value.trim()) return undefined
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

const groupToForm = (group: IProxyGroupConfig | null | undefined) => {
  const form = cloneInitialForm()
  if (!group) return form

  form.type = group.type
  form.name = group.name
  form.proxies = Array.isArray(group.proxies) ? group.proxies : []
  form.use = Array.isArray(group.use) ? group.use : []
  form.includeAll = group['include-all'] === true
  form.includeAllProxies = group['include-all-proxies'] === true
  form.includeAllProviders = group['include-all-providers'] === true
  form.url = toText(group.url) || form.url
  form.interval = toText(group.interval ?? form.interval)
  form.timeout = toText(group.timeout ?? form.timeout)
  form.tolerance = toText((group as any).tolerance)
  form.strategy = toText((group as any).strategy)
  form.filter = toText(group.filter)
  form.excludeFilter = toText(group['exclude-filter'])
  form.icon = toText(group.icon)
  form.hidden = group.hidden === true
  form.lazy = group.lazy !== false
  form.disableUdp = group['disable-udp'] === true

  return form
}

const validateForm = (
  form: ManualGroupForm,
  existingNames: Set<string>,
  tr: (key: string) => string,
) => {
  const errors: FormErrors = {}
  const name = form.name.trim()

  if (!name) errors.name = tr('errors.nameRequired')
  if (name && existingNames.has(name)) errors.name = tr('errors.nameExists')

  if (
    form.proxies.length === 0 &&
    form.use.length === 0 &&
    !form.includeAll &&
    !form.includeAllProxies &&
    !form.includeAllProviders
  ) {
    errors.proxies = tr('errors.policiesRequired')
  }

  return errors
}

const buildGroup = (form: ManualGroupForm): IProxyGroupConfig => {
  const group: Record<string, unknown> = {
    name: form.name.trim(),
    type: form.type,
  }

  if (form.proxies.length > 0) group.proxies = form.proxies
  if (form.use.length > 0) group.use = form.use
  if (form.includeAll) group['include-all'] = true
  if (form.includeAllProxies) group['include-all-proxies'] = true
  if (form.includeAllProviders) group['include-all-providers'] = true
  if (form.icon.trim()) group.icon = form.icon.trim()
  if (form.filter.trim()) group.filter = form.filter.trim()
  if (form.excludeFilter.trim())
    group['exclude-filter'] = form.excludeFilter.trim()
  if (form.hidden) group.hidden = true
  if (form.disableUdp) group['disable-udp'] = true
  if (form.type !== 'select') {
    if (form.url.trim()) group.url = form.url.trim()
    group.interval = toNumber(form.interval) ?? 300
    group.timeout = toNumber(form.timeout) ?? 5000
    group.lazy = form.lazy
  }
  if (form.type === 'load-balance' && form.strategy.trim()) {
    group.strategy = form.strategy.trim()
  }
  if (form.type === 'url-test' && form.tolerance.trim()) {
    group.tolerance = toNumber(form.tolerance)
  }

  return group as unknown as IProxyGroupConfig
}

const ManualGroupViewerContent = (props: ManualGroupViewerProps) => {
  const {
    existingNames,
    policyOptions,
    proxyOptions = EMPTY_POLICY_OPTIONS,
    groupOptions = EMPTY_POLICY_OPTIONS,
    mode = 'add',
    initialGroup,
    onClose,
    onAdd,
    onSave,
  } = props
  const { t } = useTranslation()
  const tr = useCallback((key: string) => t(`${TR_PREFIX}.${key}` as any), [t])
  const isEdit = mode === 'edit'
  const initialGroupForm = useMemo(
    () => groupToForm(initialGroup),
    [initialGroup],
  )
  const [step, setStep] = useState<GroupStep>(0)
  const [form, setForm] = useState<ManualGroupForm>(initialGroupForm)
  const [stablePolicyOptions] = useState(() =>
    Array.from(
      new Set(
        [...initialGroupForm.proxies, ...policyOptions].filter(
          (policy): policy is string => typeof policy === 'string' && !!policy,
        ),
      ),
    ),
  )
  const [stableProxyOptions] = useState(() => new Set(proxyOptions))
  const [stableGroupOptions] = useState(() => new Set(groupOptions))
  const [errors, setErrors] = useState<FormErrors>({})
  const existingNameSet = useMemo(
    () => new Set(existingNames.filter(Boolean)),
    [existingNames],
  )
  const policyOptionGroups = useMemo<PolicyOptionGroup[]>(() => {
    const available = new Set(stablePolicyOptions)
    const used = new Set<string>()
    const take = (options: string[]) =>
      options.filter((option) => {
        if (!available.has(option) || used.has(option)) return false
        used.add(option)
        return true
      })

    const groups: PolicyOptionGroup[] = [
      {
        key: 'builtin',
        label: tr('policyGroups.builtin'),
        options: take(BUILTIN_POLICY_OPTIONS),
      },
      {
        key: 'proxy',
        label: tr('policyGroups.proxies'),
        options: take(
          stablePolicyOptions.filter((item) => stableProxyOptions.has(item)),
        ),
      },
      {
        key: 'group',
        label: tr('policyGroups.groups'),
        options: take(
          stablePolicyOptions.filter((item) => stableGroupOptions.has(item)),
        ),
      },
      {
        key: 'other',
        label: tr('policyGroups.other'),
        options: take(stablePolicyOptions),
      },
    ]

    return groups.filter((group) => group.options.length > 0)
  }, [stableGroupOptions, stablePolicyOptions, stableProxyOptions, tr])

  const setField = <Key extends keyof ManualGroupForm>(
    key: Key,
    value: ManualGroupForm[Key],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const togglePolicy = (policy: string) => {
    setForm((prev) => {
      const exists = prev.proxies.includes(policy)
      return {
        ...prev,
        proxies: exists
          ? prev.proxies.filter((item) => item !== policy)
          : [...prev.proxies, policy],
      }
    })
    setErrors((prev) => ({ ...prev, proxies: undefined }))
  }

  const handleClose = () => {
    onClose()
  }

  const handleNext = () => {
    if (step < 2) setStep((prev) => (prev + 1) as GroupStep)
  }

  const handleBack = () => {
    if (step > 0) setStep((prev) => (prev - 1) as GroupStep)
  }

  const handleSubmit = (placement?: GroupPlacement) => {
    const nextErrors = validateForm(form, existingNameSet, tr)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setStep(nextErrors.proxies ? 1 : 2)
      return
    }

    const group = buildGroup(form)
    if (isEdit) {
      onSave?.(group)
    } else if (placement) {
      onAdd(group, placement)
    }
    onClose()
  }

  return (
    <Dialog open={true} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ px: 3, py: 2.25 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {isEdit ? tr('editTitle') : tr('title')}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, fontWeight: 700 }}>
          {tr(`steps.${step}`)}
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {step === 0 && (
          <Box sx={{ p: 3 }}>
            {GROUP_TYPES.map((item) => (
              <TypeRow
                key={item.value}
                active={form.type === item.value}
                onClick={() => setField('type', item.value)}
              >
                <Radio
                  checked={form.type === item.value}
                  onChange={() => setField('type', item.value)}
                />
                <Box>
                  <Typography sx={{ fontSize: 18, fontWeight: 800 }}>
                    {tr(item.titleKey)}
                  </Typography>
                  <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                    {tr(item.descKey)}
                  </Typography>
                </Box>
              </TypeRow>
            ))}
          </Box>
        )}

        {step === 1 && (
          <TwoPane>
            <Box>
              <SectionTitle>{tr('sections.policies')}</SectionTitle>
              <PolicyList>
                {policyOptionGroups.map((group, groupIndex) => (
                  <Box key={group.key}>
                    {groupIndex > 0 ? <Divider /> : null}
                    <PolicyGroupHeader>{group.label}</PolicyGroupHeader>
                    {group.options.map((policy) => (
                      <PolicyRow
                        key={policy}
                        onClick={() => togglePolicy(policy)}
                      >
                        <Checkbox
                          checked={form.proxies.includes(policy)}
                          onChange={() => togglePolicy(policy)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        <Typography>{policy}</Typography>
                      </PolicyRow>
                    ))}
                  </Box>
                ))}
              </PolicyList>
              {errors.proxies && (
                <Typography color="error" sx={{ mt: 1 }}>
                  {errors.proxies}
                </Typography>
              )}
            </Box>

            <Box>
              <SectionTitle>{tr('sections.external')}</SectionTitle>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.includeAll}
                    onChange={(event) =>
                      setField('includeAll', event.target.checked)
                    }
                  />
                }
                label={tr('fields.includeAll')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.includeAllProxies}
                    onChange={(event) =>
                      setField('includeAllProxies', event.target.checked)
                    }
                  />
                }
                label={tr('fields.includeAllProxies')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.includeAllProviders}
                    onChange={(event) =>
                      setField('includeAllProviders', event.target.checked)
                    }
                  />
                }
                label={tr('fields.includeAllProviders')}
              />
              <TextField
                fullWidth
                size="small"
                label={tr('fields.filter')}
                value={form.filter}
                onChange={(event) => setField('filter', event.target.value)}
                sx={{ mt: 2 }}
              />
              <TextField
                fullWidth
                size="small"
                label={tr('fields.excludeFilter')}
                value={form.excludeFilter}
                onChange={(event) =>
                  setField('excludeFilter', event.target.value)
                }
                sx={{ mt: 2 }}
              />
            </Box>
          </TwoPane>
        )}

        {step === 2 && (
          <Box sx={{ p: 3, display: 'grid', gap: 2 }}>
            <FieldRow>
              <Typography sx={{ width: 160, fontWeight: 800 }}>
                {tr('fields.name')}
              </Typography>
              <TextField
                autoFocus
                fullWidth
                size="small"
                value={form.name}
                error={!!errors.name}
                helperText={errors.name}
                onChange={(event) => setField('name', event.target.value)}
              />
            </FieldRow>

            {form.type !== 'select' && (
              <>
                <FieldRow>
                  <Typography sx={{ width: 160, fontWeight: 800 }}>
                    {tr('fields.url')}
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={form.url}
                    onChange={(event) => setField('url', event.target.value)}
                  />
                </FieldRow>
                <FieldRow>
                  <Typography sx={{ width: 160, fontWeight: 800 }}>
                    {tr('fields.interval')}
                  </Typography>
                  <TextField
                    size="small"
                    value={form.interval}
                    onChange={(event) =>
                      setField('interval', event.target.value)
                    }
                    sx={{ width: 160 }}
                  />
                  <Typography color="text.secondary">
                    {t('shared.units.seconds')}
                  </Typography>
                  <Typography sx={{ width: 80, ml: 2, fontWeight: 800 }}>
                    {t('shared.labels.timeout')}
                  </Typography>
                  <TextField
                    size="small"
                    value={form.timeout}
                    onChange={(event) =>
                      setField('timeout', event.target.value)
                    }
                    sx={{ width: 160 }}
                  />
                  <Typography color="text.secondary">
                    {t('shared.units.milliseconds')}
                  </Typography>
                </FieldRow>
              </>
            )}

            {form.type === 'url-test' && (
              <FieldRow>
                <Typography sx={{ width: 160, fontWeight: 800 }}>
                  {tr('fields.tolerance')}
                </Typography>
                <TextField
                  size="small"
                  value={form.tolerance}
                  onChange={(event) =>
                    setField('tolerance', event.target.value)
                  }
                  sx={{ width: 160 }}
                />
              </FieldRow>
            )}

            {form.type === 'load-balance' && (
              <FieldRow>
                <Typography sx={{ width: 160, fontWeight: 800 }}>
                  {tr('fields.strategy')}
                </Typography>
                <TextField
                  select
                  size="small"
                  value={form.strategy}
                  onChange={(event) => setField('strategy', event.target.value)}
                  sx={{ width: 240 }}
                >
                  <MenuItem value="">{tr('options.default')}</MenuItem>
                  <MenuItem value="round-robin">round-robin</MenuItem>
                  <MenuItem value="consistent-hashing">
                    consistent-hashing
                  </MenuItem>
                </TextField>
              </FieldRow>
            )}

            <FieldRow>
              <Typography sx={{ width: 160, fontWeight: 800 }}>
                {tr('fields.icon')}
              </Typography>
              <TextField
                fullWidth
                size="small"
                value={form.icon}
                onChange={(event) => setField('icon', event.target.value)}
              />
            </FieldRow>

            <Box sx={{ display: 'flex', gap: 3, pl: 20 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.lazy}
                    onChange={(event) => setField('lazy', event.target.checked)}
                  />
                }
                label={tr('fields.lazy')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.disableUdp}
                    onChange={(event) =>
                      setField('disableUdp', event.target.checked)
                    }
                  />
                }
                label={tr('fields.disableUdp')}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.hidden}
                    onChange={(event) =>
                      setField('hidden', event.target.checked)
                    }
                  />
                }
                label={tr('fields.hidden')}
              />
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleClose} variant="outlined">
          {t('shared.actions.cancel')}
        </Button>
        {step > 0 && (
          <Button startIcon={<ArrowBackRounded />} onClick={handleBack}>
            {tr('actions.back')}
          </Button>
        )}
        {step < 2 ? (
          <Button
            variant="contained"
            endIcon={<ArrowForwardRounded />}
            onClick={handleNext}
          >
            {tr('actions.next')}
          </Button>
        ) : isEdit ? (
          <Button
            variant="contained"
            startIcon={<SaveRounded />}
            onClick={() => handleSubmit()}
          >
            {t('shared.actions.save')}
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={<CheckRounded />}
              onClick={() => handleSubmit('prepend')}
            >
              {tr('actions.prepend')}
            </Button>
            <Button
              variant="contained"
              startIcon={<CheckRounded />}
              onClick={() => handleSubmit('append')}
            >
              {tr('actions.append')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

export const ManualGroupViewer = (props: ManualGroupViewerProps) => {
  const { open, mode, initialGroup } = props
  if (!open) return null

  const key = initialGroup
    ? `${mode ?? 'add'}:${initialGroup.name}:${initialGroup.type}`
    : `${mode ?? 'add'}:new`

  return <ManualGroupViewerContent key={key} {...props} />
}

const TypeRow = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'active',
})<{ active: boolean }>(({ theme, active }) => ({
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: theme.spacing(1),
  alignItems: 'start',
  padding: theme.spacing(1.25, 0),
  cursor: 'pointer',
  color: active ? theme.palette.text.primary : theme.palette.text.secondary,
}))

const TwoPane = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: theme.spacing(3),
  padding: theme.spacing(3),
}))

const SectionTitle = styled(Typography)(({ theme }) => ({
  fontSize: 17,
  fontWeight: 800,
  marginBottom: theme.spacing(1.5),
}))

const PolicyList = styled(Box)(({ theme }) => ({
  height: 360,
  overflow: 'auto',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 6,
}))

const PolicyGroupHeader = styled(Typography)(({ theme }) => ({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  padding: theme.spacing(0.75, 1.5),
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.secondary,
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
}))

const PolicyRow = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '48px 1fr',
  alignItems: 'center',
  minHeight: 36,
  cursor: 'pointer',
  '&:nth-of-type(odd)': {
    backgroundColor: alpha(theme.palette.text.primary, 0.04),
  },
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.12),
  },
}))

const FieldRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.25),
}))
