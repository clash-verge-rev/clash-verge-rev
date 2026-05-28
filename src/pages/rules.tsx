import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AddRounded,
  ContentCopyRounded,
  DeleteRounded,
  DragIndicatorRounded,
  EditRounded,
  PlaylistAddRounded,
} from '@mui/icons-material'
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  ListSubheader,
  ListItemIcon,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import yaml from 'js-yaml'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type UIEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { Rule } from 'tauri-plugin-mihomo-api'

import {
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  type SearchState,
} from '@/components/base'
import { ScrollTopButton } from '@/components/layout/scroll-top-button'
import { ProviderButton } from '@/components/rule/provider-button'
import { useProfiles } from '@/hooks/use-profiles'
import { useVisibility } from '@/hooks/use-visibility'
import {
  useAppRefreshers,
  useProxiesData,
  useRulesData,
} from '@/providers/app-data-context'
import {
  ensureProfileProxies,
  enhanceProfiles,
  readProfileFile,
  saveProfileFile,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

type RuleSource = 'prepend' | 'runtime' | 'append'
type ManualRuleSource = Exclude<RuleSource, 'runtime'>
type RuleDialogKind = 'standard' | 'logical' | 'ruleset'
type RuleDialogMode = 'add' | 'edit' | 'duplicate'

interface ManualRulesDocument {
  prepend: string[]
  append: string[]
  delete: string[]
}

interface ParsedRule {
  type: string
  value: string
  policy: string
  noResolve: boolean
}

interface ManagedRuleRow extends ParsedRule {
  id: string
  raw: string
  lineNo: number
  source: RuleSource
  manualIndex?: number
  searchText: string
}

interface RuleForm {
  type: string
  value: string
  policy: string
  noResolve: boolean
}

interface PolicyOptionGroup {
  key: 'builtin' | 'proxy' | 'group' | 'other'
  label: string
  options: string[]
}

interface RuleDedupEntry {
  list: string[]
  index: number
  noResolve: boolean
}

const builtinProxyPolicies = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']

const geoipRegionCodes = [
  'CN',
  'HK',
  'MO',
  'TW',
  'US',
  'JP',
  'KR',
  'SG',
  'GB',
  'DE',
  'FR',
  'CA',
  'AU',
  'IN',
  'RU',
  'BR',
  'EU',
  'PRIVATE',
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'GA',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TZ',
  'UA',
  'UG',
  'UM',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
]

const standardRuleTypes = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'GEOSITE',
  'GEOIP',
  'SRC-GEOIP',
  'IP-ASN',
  'SRC-IP-ASN',
  'IP-CIDR',
  'IP-CIDR6',
  'SRC-IP-CIDR',
  'IP-SUFFIX',
  'SRC-IP-SUFFIX',
  'SRC-PORT',
  'DST-PORT',
  'IN-PORT',
  'DSCP',
  'PROCESS-NAME',
  'PROCESS-PATH',
  'PROCESS-NAME-REGEX',
  'PROCESS-PATH-REGEX',
  'NETWORK',
  'UID',
  'IN-TYPE',
  'IN-USER',
  'IN-NAME',
  'SUB-RULE',
  'MATCH',
]

const logicalRuleTypes = ['AND', 'OR', 'NOT']
const rulesetRuleTypes = ['RULE-SET']

const noResolveRuleTypes = new Set([
  'GEOIP',
  'IP-ASN',
  'IP-CIDR',
  'IP-CIDR6',
  'IP-SUFFIX',
  'RULE-SET',
])

const ruleTypeExamples: Record<string, string> = {
  DOMAIN: 'example.com',
  'DOMAIN-SUFFIX': 'example.com',
  'DOMAIN-KEYWORD': 'example',
  'DOMAIN-REGEX': 'example.*',
  GEOSITE: 'youtube / CN / geolocation-!cn',
  GEOIP: 'CN',
  'SRC-GEOIP': 'CN',
  'IP-ASN': '13335',
  'SRC-IP-ASN': '9808',
  'IP-CIDR': '127.0.0.0/8',
  'IP-CIDR6': '2620:0:2d0:200::7/32',
  'SRC-IP-CIDR': '192.168.1.201/32',
  'IP-SUFFIX': '8.8.8.8/24',
  'SRC-IP-SUFFIX': '192.168.1.201/8',
  'SRC-PORT': '7777',
  'DST-PORT': '80',
  'IN-PORT': '7897',
  DSCP: '4',
  'PROCESS-NAME': 'curl',
  'PROCESS-PATH': '/usr/bin/wget',
  'PROCESS-NAME-REGEX': '.*telegram.*',
  'PROCESS-PATH-REGEX': '.*bin/wget',
  NETWORK: 'udp',
  UID: '1001',
  'IN-TYPE': 'SOCKS/HTTP',
  'IN-USER': 'mihomo',
  'IN-NAME': 'ss',
  'SUB-RULE': '(NETWORK,tcp)',
  'RULE-SET': 'provider-name',
  AND: '((DOMAIN,example.com),(NETWORK,UDP))',
  OR: '((DOMAIN,example.com),(NETWORK,UDP))',
  NOT: '((DOMAIN,example.com))',
}

const runtimeRuleTypeMap: Record<string, string> = {
  Domain: 'DOMAIN',
  DomainSuffix: 'DOMAIN-SUFFIX',
  DomainKeyword: 'DOMAIN-KEYWORD',
  DomainRegex: 'DOMAIN-REGEX',
  GeoSite: 'GEOSITE',
  GeoIP: 'GEOIP',
  SrcGeoIP: 'SRC-GEOIP',
  IPASN: 'IP-ASN',
  SrcIPASN: 'SRC-IP-ASN',
  IPCIDR: 'IP-CIDR',
  SrcIPCIDR: 'SRC-IP-CIDR',
  IPSuffix: 'IP-SUFFIX',
  SrcIPSuffix: 'SRC-IP-SUFFIX',
  SrcPort: 'SRC-PORT',
  DstPort: 'DST-PORT',
  InPort: 'IN-PORT',
  InUser: 'IN-USER',
  InName: 'IN-NAME',
  InType: 'IN-TYPE',
  ProcessName: 'PROCESS-NAME',
  ProcessPath: 'PROCESS-PATH',
  ProcessNameRegex: 'PROCESS-NAME-REGEX',
  ProcessPathRegex: 'PROCESS-PATH-REGEX',
  Match: 'MATCH',
  RuleSet: 'RULE-SET',
  Network: 'NETWORK',
  DSCP: 'DSCP',
  Uid: 'UID',
  SubRules: 'SUB-RULE',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
}

const emptyManualRules = (): ManualRulesDocument => ({
  prepend: [],
  append: [],
  delete: [],
})

const cloneManualRules = (
  document: ManualRulesDocument,
): ManualRulesDocument => ({
  prepend: [...document.prepend],
  append: [...document.append],
  delete: [...document.delete],
})

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

const normalizeManualRules = (data: string): ManualRulesDocument => {
  const obj = yaml.load(data) as Partial<ManualRulesDocument> | null
  return {
    prepend: toStringArray(obj?.prepend),
    append: toStringArray(obj?.append),
    delete: toStringArray(obj?.delete),
  }
}

const dumpManualRules = (document: ManualRulesDocument) =>
  yaml.dump(document, { forceQuotes: true })

const parseRuleRaw = (raw: string): ParsedRule => {
  const parts = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const type = parts.shift()?.toUpperCase() ?? ''
  const noResolve = parts.at(-1)?.toLowerCase() === 'no-resolve'

  if (noResolve) parts.pop()

  const policy = parts.pop() ?? ''

  return {
    type,
    value: parts.join(','),
    policy,
    noResolve,
  }
}

const normalizeRuleValue = (type: string, value: string) => {
  const normalizedType = type.trim().toUpperCase()
  const trimmedValue = value.trim()

  if (isGeoipRule(normalizedType)) return trimmedValue.toUpperCase()

  return trimmedValue
}

const buildParsedRuleRaw = (rule: ParsedRule) => {
  const type = rule.type.trim().toUpperCase()
  const policy = rule.policy.trim()
  const value =
    type === 'MATCH' ? '' : normalizeRuleValue(type, rule.value.trim())
  const base = value ? `${type},${value},${policy}` : `${type},${policy}`

  return rule.noResolve && noResolveRuleTypes.has(type)
    ? `${base},no-resolve`
    : base
}

const buildRuleRaw = (form: RuleForm) =>
  buildParsedRuleRaw({
    type: form.type,
    value: form.value,
    policy: form.policy,
    noResolve: form.noResolve,
  })

const runtimeRuleToRaw = (rule: Rule) => {
  const type = runtimeRuleTypeMap[rule.type] ?? rule.type.toUpperCase()
  const payload = rule.payload?.trim()

  return payload ? `${type},${payload},${rule.proxy}` : `${type},${rule.proxy}`
}

const getRuleIdentitySignature = (rule: ParsedRule) =>
  [
    rule.type.trim().toUpperCase(),
    normalizeRuleValue(rule.type, rule.value),
    rule.policy.trim(),
  ].join('\n')

const getRawRuleIdentitySignature = (raw: string) => {
  const parsed = parseRuleRaw(raw)
  return parsed.type && parsed.policy
    ? getRuleIdentitySignature(parsed)
    : raw.trim()
}

const normalizeRuleRaw = (raw: string) => {
  const parsed = parseRuleRaw(raw)

  if (!parsed.type || !parsed.policy) return raw.trim()

  return buildParsedRuleRaw(parsed)
}

const sanitizeRuleList = (
  list: string[],
  seen = new Map<string, RuleDedupEntry>(),
) => {
  const next: string[] = []

  list.forEach((raw) => {
    const normalizedRaw = normalizeRuleRaw(raw)
    if (!normalizedRaw) return

    const parsed = parseRuleRaw(normalizedRaw)
    const signature =
      parsed.type && parsed.policy
        ? getRuleIdentitySignature(parsed)
        : normalizedRaw.trim()
    const existing = seen.get(signature)

    if (existing) {
      if (!existing.noResolve && parsed.noResolve) {
        existing.list[existing.index] = normalizedRaw
        existing.noResolve = true
      }
      return
    }

    seen.set(signature, {
      list: next,
      index: next.length,
      noResolve: parsed.noResolve,
    })
    next.push(normalizedRaw)
  })

  return next
}

const sanitizeManualRules = (
  document: ManualRulesDocument,
): ManualRulesDocument => {
  const manualSeen = new Map<string, RuleDedupEntry>()

  return {
    prepend: sanitizeRuleList(document.prepend, manualSeen),
    append: sanitizeRuleList(document.append, manualSeen),
    delete: sanitizeRuleList(document.delete),
  }
}

const makeSearchText = (row: ParsedRule, source: string, raw: string) =>
  [row.type, row.value, row.policy, source, raw].join(' ')

const removeAt = (list: string[], index?: number, fallbackRaw?: string) => {
  if (typeof index === 'number' && index >= 0 && index < list.length) {
    return list.filter((_, currentIndex) => currentIndex !== index)
  }

  if (fallbackRaw) {
    const next = [...list]
    const foundIndex = next.indexOf(fallbackRaw)
    if (foundIndex >= 0) next.splice(foundIndex, 1)
    return next
  }

  return list
}

const replaceAt = (
  list: string[],
  index: number | undefined,
  fallbackRaw: string | undefined,
  raw: string,
) => {
  const next = [...list]

  if (typeof index === 'number' && index >= 0 && index < next.length) {
    next[index] = raw
    return next
  }

  if (fallbackRaw) {
    const foundIndex = next.indexOf(fallbackRaw)
    if (foundIndex >= 0) {
      next[foundIndex] = raw
      return next
    }
  }

  next.unshift(raw)
  return next
}

const insertAt = (list: string[], index: number | undefined, raw: string) => {
  const next = [...list]
  const safeIndex =
    typeof index === 'number' && index >= 0 && index <= next.length ? index : 0

  next.splice(safeIndex, 0, raw)
  return next
}

const isManualRuleSource = (source: RuleSource): source is ManualRuleSource =>
  source !== 'runtime'

const addRuleDelete = (document: ManualRulesDocument, raw: string) => {
  const signature = getRawRuleIdentitySignature(raw)
  const exists = document.delete.some(
    (item) => getRawRuleIdentitySignature(item) === signature,
  )

  if (!exists) document.delete.push(raw)
}

const revealRuntimeRuleIfUnshadowed = (
  document: ManualRulesDocument,
  raw: string,
) => {
  const signature = getRawRuleIdentitySignature(raw)
  const hasManualRule = [...document.prepend, ...document.append].some(
    (item) => getRawRuleIdentitySignature(item) === signature,
  )

  if (!hasManualRule) {
    document.delete = document.delete.filter(
      (item) => getRawRuleIdentitySignature(item) !== signature,
    )
  }
}

const getTypeOptions = (kind: RuleDialogKind) => {
  if (kind === 'logical') return logicalRuleTypes
  if (kind === 'ruleset') return rulesetRuleTypes
  return standardRuleTypes
}

const getKindFromType = (type: string): RuleDialogKind => {
  if (logicalRuleTypes.includes(type)) return 'logical'
  if (rulesetRuleTypes.includes(type)) return 'ruleset'
  return 'standard'
}

const getDefaultRuleForm = (
  kind: RuleDialogKind,
  policy: string,
): RuleForm => ({
  type: getTypeOptions(kind)[0],
  value: '',
  policy,
  noResolve: false,
})

const isGeoipRule = (type: string) => type === 'GEOIP' || type === 'SRC-GEOIP'

const getGeoipRegionLabel = (code: string, language: string) => {
  const normalizedCode = code.toUpperCase()
  if (normalizedCode === 'PRIVATE') {
    return language.startsWith('zh')
      ? 'PRIVATE - 私有网络'
      : 'PRIVATE - Private network'
  }

  try {
    const DisplayNames = (Intl as any).DisplayNames
    if (!DisplayNames) return normalizedCode

    const regionName = new DisplayNames([language], {
      type: 'region',
    }).of(normalizedCode)

    return regionName ? `${normalizedCode} - ${regionName}` : normalizedCode
  } catch {
    return normalizedCode
  }
}

const getPolicyName = (item: unknown, fallback?: string) => {
  if (item && typeof item === 'object' && 'name' in item) {
    const name = (item as { name?: unknown }).name
    if (typeof name === 'string' && name) return name
  }

  return fallback && !/^\d+$/.test(fallback) ? fallback : undefined
}

const ruleTableColumns =
  '40px 64px minmax(132px, 180px) minmax(220px, 1fr) minmax(120px, 180px) 96px'

const RuleTableHeader = () => {
  const { t } = useTranslation()

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: ruleTableColumns,
        alignItems: 'center',
        px: 2,
        py: 1,
        borderTop: '1px solid var(--divider-color)',
        borderBottom: '1px solid var(--divider-color)',
        bgcolor: 'rgba(255,255,255,0.03)',
        color: 'text.secondary',
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <Box />
      <Box>{t('rules.page.table.id')}</Box>
      <Box>{t('rules.page.table.type')}</Box>
      <Box>{t('rules.page.table.value')}</Box>
      <Box>{t('rules.page.table.policy')}</Box>
      <Box>{t('rules.page.table.source')}</Box>
    </Box>
  )
}

interface RuleRowProps {
  row: ManagedRuleRow
  selected: boolean
  dragDisabled: boolean
  onSelect: (row: ManagedRuleRow) => void
  onEdit: (row: ManagedRuleRow) => void
  onContextMenu: (event: MouseEvent<HTMLElement>, row: ManagedRuleRow) => void
}

const RuleTableRow = (props: RuleRowProps) => {
  const { row, selected, dragDisabled, onSelect, onContextMenu, onEdit } = props
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id, disabled: dragDisabled })
  const sourceLabel =
    row.source === 'runtime'
      ? t('rules.page.sources.runtime')
      : t('rules.page.sources.manual')

  return (
    <Box
      ref={setNodeRef}
      onClick={() => onSelect(row)}
      onContextMenu={(event) => onContextMenu(event, row)}
      onDoubleClick={() => onEdit(row)}
      sx={{
        display: 'grid',
        gridTemplateColumns: ruleTableColumns,
        alignItems: 'center',
        minHeight: 44,
        px: 2,
        borderBottom: '1px solid var(--divider-color)',
        color: 'text.primary',
        cursor: 'pointer',
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.72 : 1,
        zIndex: isDragging ? 1 : undefined,
        bgcolor: selected ? 'rgba(25,118,210,0.22)' : undefined,
        '&:nth-of-type(even)': {
          bgcolor: selected
            ? 'rgba(25,118,210,0.22)'
            : 'rgba(255,255,255,0.025)',
        },
        '&:hover': {
          bgcolor: selected ? 'rgba(25,118,210,0.28)' : 'rgba(25,118,210,0.14)',
        },
      }}
      title={row.raw}
    >
      <Box
        {...(dragDisabled ? {} : attributes)}
        {...(dragDisabled ? {} : listeners)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          color: dragDisabled ? 'text.disabled' : 'text.secondary',
          cursor: dragDisabled ? 'default' : isDragging ? 'grabbing' : 'grab',
        }}
      >
        <DragIndicatorRounded fontSize="small" />
      </Box>
      <Typography
        color="text.secondary"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {row.lineNo}
      </Typography>
      <Typography noWrap sx={{ fontWeight: 700 }}>
        {row.type || '-'}
      </Typography>
      <Typography noWrap sx={{ userSelect: 'text' }}>
        {row.value || '-'}
        {row.noResolve ? (
          <Typography
            component="span"
            color="text.secondary"
            sx={{ ml: 1, fontSize: 12 }}
          >
            no-resolve
          </Typography>
        ) : null}
      </Typography>
      <Typography
        noWrap
        color={row.policy === 'REJECT' ? 'error.main' : 'text.primary'}
      >
        {row.policy || '-'}
      </Typography>
      <Typography noWrap color="text.secondary" sx={{ fontSize: 13 }}>
        {sourceLabel}
      </Typography>
    </Box>
  )
}

interface RuleEditorDialogProps {
  open: boolean
  mode: RuleDialogMode
  kind: RuleDialogKind
  form: RuleForm
  policyOptionGroups: PolicyOptionGroup[]
  providerOptions: string[]
  onClose: () => void
  onChange: (form: RuleForm) => void
  onSubmit: () => void
}

const RuleEditorDialog = (props: RuleEditorDialogProps) => {
  const {
    open,
    mode,
    kind,
    form,
    policyOptionGroups,
    providerOptions,
    onClose,
    onChange,
    onSubmit,
  } = props
  const { t, i18n } = useTranslation()
  const typeOptions = getTypeOptions(kind)
  const policyOptions = useMemo(
    () => policyOptionGroups.flatMap((group) => group.options),
    [policyOptionGroups],
  )
  const selectablePolicies = useMemo(
    () => Array.from(new Set([...policyOptions, form.policy].filter(Boolean))),
    [form.policy, policyOptions],
  )
  const missingPolicyOptions = useMemo(
    () =>
      selectablePolicies.filter(
        (policy) =>
          !policyOptionGroups.some((group) => group.options.includes(policy)),
      ),
    [policyOptionGroups, selectablePolicies],
  )
  const selectablePolicyGroups = useMemo(() => {
    const groups = policyOptionGroups.filter(
      (group) => group.options.length > 0,
    )

    return missingPolicyOptions.length > 0
      ? [
          ...groups,
          {
            key: 'other' as const,
            label: t('rules.page.policyGroups.other'),
            options: missingPolicyOptions,
          },
        ]
      : groups
  }, [missingPolicyOptions, policyOptionGroups, t])
  const selectableProviders = useMemo(
    () => Array.from(new Set([...providerOptions, form.value].filter(Boolean))),
    [form.value, providerOptions],
  )
  const geoipRegionOptions = useMemo(
    () =>
      Array.from(new Set([...geoipRegionCodes, form.value.toUpperCase()]))
        .filter(Boolean)
        .map((code) => ({
          code,
          label: getGeoipRegionLabel(code, i18n.language),
        })),
    [form.value, i18n.language],
  )
  const requiresValue = form.type !== 'MATCH'
  const canUseNoResolve = noResolveRuleTypes.has(form.type)
  const isGeositeRule = form.type === 'GEOSITE'
  const title =
    mode === 'edit'
      ? t('rules.page.dialogs.editTitle')
      : mode === 'duplicate'
        ? t('rules.page.dialogs.duplicateTitle')
        : t(`rules.page.actions.${kind}`)
  const policyMenuItems = useMemo(
    () =>
      selectablePolicyGroups.flatMap((group, groupIndex) => [
        ...(groupIndex > 0
          ? [<Divider key={`${group.key}-divider`} component="li" />]
          : []),
        <ListSubheader key={`${group.key}-header`} disableSticky>
          {group.label}
        </ListSubheader>,
        ...group.options.map((policy) => (
          <MenuItem key={`${group.key}:${policy}`} value={policy}>
            {policy}
          </MenuItem>
        )),
      ]),
    [selectablePolicyGroups],
  )

  const updateForm = (patch: Partial<RuleForm>) => {
    const next = { ...form, ...patch }
    if (!noResolveRuleTypes.has(next.type)) next.noResolve = false
    if (next.type === 'MATCH') next.value = ''
    onChange(next)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent
        sx={{
          display: 'grid',
          gap: 2,
          pt: '12px !important',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '220px 1fr' },
            gap: 2,
          }}
        >
          <TextField
            select
            label={t('rules.modals.editor.form.labels.type')}
            value={form.type}
            onChange={(event) => updateForm({ type: event.target.value })}
          >
            {typeOptions.map((type) => (
              <MenuItem key={type} value={type}>
                {type}
              </MenuItem>
            ))}
          </TextField>

          {isGeoipRule(form.type) ? (
            <Autocomplete
              options={geoipRegionOptions}
              value={
                geoipRegionOptions.find(
                  (option) => option.code === form.value.toUpperCase(),
                ) ?? null
              }
              getOptionLabel={(option) =>
                typeof option === 'string' ? option : option.label
              }
              onChange={(_, value) => {
                updateForm({ value: value?.code ?? '' })
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('rules.modals.editor.form.labels.content')}
                  placeholder="CN"
                />
              )}
            />
          ) : form.type === 'RULE-SET' && selectableProviders.length > 0 ? (
            <TextField
              select
              label={t('rules.modals.editor.form.labels.content')}
              value={form.value}
              onChange={(event) => updateForm({ value: event.target.value })}
            >
              {selectableProviders.map((provider) => (
                <MenuItem key={provider} value={provider}>
                  {provider}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField
              disabled={!requiresValue}
              label={t('rules.modals.editor.form.labels.content')}
              placeholder={requiresValue ? ruleTypeExamples[form.type] : ''}
              helperText={
                isGeositeRule
                  ? t('rules.modals.editor.form.helpers.geosite')
                  : undefined
              }
              value={form.value}
              onChange={(event) => updateForm({ value: event.target.value })}
            />
          )}
        </Box>

        <Box>
          <TextField
            fullWidth
            select
            label={t('rules.modals.editor.form.labels.proxyPolicy')}
            value={form.policy}
            onChange={(event) => updateForm({ policy: event.target.value })}
          >
            {policyMenuItems}
          </TextField>
        </Box>

        <FormControlLabel
          disabled={!canUseNoResolve}
          control={
            <Checkbox
              checked={form.noResolve}
              onChange={(event) =>
                updateForm({ noResolve: event.target.checked })
              }
            />
          }
          label={t('rules.modals.editor.form.toggles.noResolve')}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('shared.actions.cancel')}</Button>
        <Button variant="contained" onClick={onSubmit}>
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const RulesPage = () => {
  const { t } = useTranslation()
  const { rules = [], ruleProviders = {} } = useRulesData()
  const { proxies: proxiesData } = useProxiesData()
  const { refreshRules, refreshRuleProviders } = useAppRefreshers()
  const { profiles, mutateProfiles } = useProfiles()
  const [searchText, setSearchText] = useState('')
  const [match, setMatch] = useState(() => (_: string) => true)
  const [manualRules, setManualRules] = useState<ManualRulesDocument>(() =>
    emptyManualRules(),
  )
  const [rulesUid, setRulesUid] = useState('')
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null)
  const [rowMenu, setRowMenu] = useState<{
    mouseX: number
    mouseY: number
    row: ManagedRuleRow
  } | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<RuleDialogMode>('add')
  const [dialogKind, setDialogKind] = useState<RuleDialogKind>('standard')
  const [activeRow, setActiveRow] = useState<ManagedRuleRow | null>(null)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const [form, setForm] = useState<RuleForm>(() =>
    getDefaultRuleForm('standard', 'DIRECT'),
  )
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const mutateProfilesRef = useRef(mutateProfiles)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const pageVisible = useVisibility()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    mutateProfilesRef.current = mutateProfiles
  }, [mutateProfiles])

  const currentProfile = useMemo(
    () => profiles?.items?.find((item) => item.uid === profiles.current),
    [profiles],
  )

  const policyOptionGroups = useMemo<PolicyOptionGroup[]>(() => {
    const proxyNames = new Set<string>()
    const groupNames = new Set<string>()

    const proxies = proxiesData?.proxies
    if (Array.isArray(proxies)) {
      proxies.forEach((proxy) => {
        const name = getPolicyName(proxy)
        if (name) proxyNames.add(name)
      })
    } else {
      Object.entries(proxies ?? {}).forEach(([key, proxy]) => {
        const name = getPolicyName(proxy, key)
        if (name) proxyNames.add(name)
      })
    }

    if (proxiesData?.global?.name) groupNames.add(proxiesData.global.name)
    ;(proxiesData?.groups ?? []).forEach((group: any) => {
      const name = getPolicyName(group)
      if (name) groupNames.add(name)
    })

    const builtinSet = new Set(builtinProxyPolicies)
    const proxyOptions = Array.from(proxyNames)
      .filter((name) => !builtinSet.has(name))
      .sort((a, b) => a.localeCompare(b))
    const groupOptions = Array.from(groupNames)
      .filter((name) => !builtinSet.has(name))
      .sort((a, b) => a.localeCompare(b))

    return [
      {
        key: 'builtin',
        label: t('rules.page.policyGroups.builtin'),
        options: builtinProxyPolicies,
      },
      {
        key: 'proxy',
        label: t('rules.page.policyGroups.proxies'),
        options: proxyOptions,
      },
      {
        key: 'group',
        label: t('rules.page.policyGroups.groups'),
        options: groupOptions,
      },
    ]
  }, [proxiesData, t])

  const policyOptions = useMemo(
    () => policyOptionGroups.flatMap((group) => group.options),
    [policyOptionGroups],
  )

  const providerOptions = useMemo(
    () => Object.keys(ruleProviders ?? {}).sort((a, b) => a.localeCompare(b)),
    [ruleProviders],
  )

  const ensureRulesFile = useCallback(async () => {
    const ensured = await ensureProfileProxies(currentProfile?.uid)
    setRulesUid(ensured.rulesUid)

    if (!currentProfile?.uid || currentProfile.uid !== ensured.profileUid) {
      await mutateProfilesRef.current()
    }

    return ensured.rulesUid
  }, [currentProfile?.uid])

  const fetchManualRules = useCallback(async () => {
    try {
      const uid = await ensureRulesFile()
      const data = await readProfileFile(uid)
      setManualRules(sanitizeManualRules(normalizeManualRules(data)))
    } catch (err: any) {
      showNotice.error(err)
    }
  }, [ensureRulesFile])

  const saveManualRules = useLockFn(async (next: ManualRulesDocument) => {
    try {
      const sanitizedNext = sanitizeManualRules(next)
      const uid = rulesUid || (await ensureRulesFile())
      if (!(await saveProfileFile(uid, dumpManualRules(sanitizedNext)))) {
        await fetchManualRules()
        return
      }

      setManualRules(sanitizedNext)
      showNotice.success('shared.feedback.notifications.saved')

      if (await enhanceProfiles()) {
        await Promise.all([refreshRules(), refreshRuleProviders()])
      }
      await mutateProfilesRef.current()
    } catch (err: any) {
      showNotice.error(err)
    }
  })

  useEffect(() => {
    refreshRules()
    refreshRuleProviders()

    if (pageVisible) {
      refreshRules()
      refreshRuleProviders()
    }
  }, [refreshRules, refreshRuleProviders, pageVisible])

  useEffect(() => {
    if (!profiles) return
    fetchManualRules()
  }, [fetchManualRules, profiles])

  const rows = useMemo<ManagedRuleRow[]>(() => {
    const manualRows = [
      ...manualRules.prepend.map((raw, index) => ({
        raw,
        source: 'prepend' as const,
        manualIndex: index,
      })),
      ...manualRules.append.map((raw, index) => ({
        raw,
        source: 'append' as const,
        manualIndex: index,
      })),
    ]

    const manualSignatures = new Set(
      manualRows.map((row) => getRawRuleIdentitySignature(row.raw)),
    )
    const deletedSignatures = new Set(
      manualRules.delete.map(getRawRuleIdentitySignature),
    )

    const runtimeRows = rules
      .map((rule, index) => {
        const raw = runtimeRuleToRaw(rule)
        const parsed = parseRuleRaw(raw)
        return {
          ...parsed,
          id: `runtime:${index}:${raw}`,
          raw,
          source: 'runtime' as const,
          searchText: makeSearchText(parsed, 'runtime', raw),
        }
      })
      .filter((row) => {
        const signature = getRuleIdentitySignature(row)
        return (
          !manualSignatures.has(signature) && !deletedSignatures.has(signature)
        )
      })

    return [
      ...manualRules.prepend.map((raw, index) => {
        const parsed = parseRuleRaw(raw)
        return {
          ...parsed,
          id: `prepend:${index}:${raw}`,
          raw,
          source: 'prepend' as const,
          manualIndex: index,
          searchText: makeSearchText(parsed, 'manual', raw),
        }
      }),
      ...runtimeRows,
      ...manualRules.append.map((raw, index) => {
        const parsed = parseRuleRaw(raw)
        return {
          ...parsed,
          id: `append:${index}:${raw}`,
          raw,
          source: 'append' as const,
          manualIndex: index,
          searchText: makeSearchText(parsed, 'manual', raw),
        }
      }),
    ].map((row, index) => ({
      ...row,
      lineNo: index + 1,
    }))
  }, [manualRules, rules])

  const filteredRows = useMemo(
    () => rows.filter((item) => match(item.searchText)),
    [rows, match],
  )

  const effectiveSelectedRowId = useMemo(() => {
    if (!selectedRowId) return null
    return rows.some((row) => row.id === selectedRowId) ? selectedRowId : null
  }, [rows, selectedRowId])

  const addRuntimeDeletesForRules = useCallback(
    (document: ManualRulesDocument, raws: string[]) => {
      const signatures = new Set(raws.map(getRawRuleIdentitySignature))

      rows.forEach((row) => {
        if (
          row.source === 'runtime' &&
          signatures.has(getRuleIdentitySignature(row))
        ) {
          addRuleDelete(document, row.raw)
        }
      })
    },
    [rows],
  )

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setShowScrollTop(event.currentTarget.scrollTop > 100)
  }, [])

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openAddDialog = (kind: RuleDialogKind) => {
    setAddMenuAnchor(null)
    setDialogMode('add')
    setDialogKind(kind)
    setActiveRow(null)
    setForm(getDefaultRuleForm(kind, policyOptions[0] ?? 'DIRECT'))
    setDialogOpen(true)
  }

  const openRowDialog = (row: ManagedRuleRow, mode: RuleDialogMode) => {
    const kind = getKindFromType(row.type)

    setRowMenu(null)
    setDialogMode(mode)
    setDialogKind(kind)
    setActiveRow(row)
    setForm({
      type: row.type,
      value: row.value,
      policy: row.policy || policyOptions[0] || 'DIRECT',
      noResolve: row.noResolve,
    })
    setDialogOpen(true)
  }

  const applyDelete = useCallback(
    async (row: ManagedRuleRow) => {
      const next = cloneManualRules(manualRules)

      if (row.source === 'prepend') {
        next.prepend = removeAt(next.prepend, row.manualIndex, row.raw)
        revealRuntimeRuleIfUnshadowed(next, row.raw)
      } else if (row.source === 'append') {
        next.append = removeAt(next.append, row.manualIndex, row.raw)
        revealRuntimeRuleIfUnshadowed(next, row.raw)
      } else {
        addRuleDelete(next, row.raw)
      }

      setRowMenu(null)
      await saveManualRules(next)
    },
    [manualRules, saveManualRules],
  )

  const handleSubmitDialog = useLockFn(async () => {
    const raw = buildRuleRaw(form)

    if (!form.type || !form.policy) {
      showNotice.error('rules.page.validation.required')
      return
    }

    if (form.type !== 'MATCH' && !form.value.trim()) {
      showNotice.error('rules.modals.editor.form.validation.conditionRequired')
      return
    }

    const next = cloneManualRules(manualRules)

    if (dialogMode === 'edit' && activeRow) {
      if (activeRow.source === 'runtime') {
        addRuleDelete(next, activeRow.raw)
        next.prepend.unshift(raw)
      } else if (isManualRuleSource(activeRow.source)) {
        next[activeRow.source] = replaceAt(
          next[activeRow.source],
          activeRow.manualIndex,
          activeRow.raw,
          raw,
        )
        revealRuntimeRuleIfUnshadowed(next, activeRow.raw)
      }

      addRuntimeDeletesForRules(next, [raw])
      setDialogOpen(false)
      await saveManualRules(next)
      return
    }

    if (dialogMode === 'add' || dialogMode === 'duplicate' || !activeRow) {
      const targetRow =
        dialogMode === 'duplicate'
          ? activeRow
          : rows.find((row) => row.id === effectiveSelectedRowId)

      if (targetRow && isManualRuleSource(targetRow.source)) {
        const insertIndex =
          (targetRow.manualIndex ?? 0) + (dialogMode === 'duplicate' ? 1 : 0)
        next[targetRow.source] = insertAt(
          next[targetRow.source],
          insertIndex,
          raw,
        )
      } else {
        next.prepend.unshift(raw)
      }

      addRuntimeDeletesForRules(next, [raw])
      setDialogOpen(false)
      setSelectedRowId(null)
      await saveManualRules(next)
      return
    }

    setDialogOpen(false)
    await saveManualRules(next)
  })

  const handleContextMenu = (
    event: MouseEvent<HTMLElement>,
    row: ManagedRuleRow,
  ) => {
    event.preventDefault()
    setSelectedRowId(row.id)
    setRowMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      row,
    })
  }

  const handleSelectRow = (row: ManagedRuleRow) => {
    setSelectedRowId(row.id)
  }

  const dragDisabled = searchText.trim().length > 0

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event

      if (dragDisabled || !over || active.id === over.id) return

      const activeRow = rows.find((row) => row.id === active.id)
      const overRow = rows.find((row) => row.id === over.id)

      if (
        !activeRow ||
        !overRow ||
        !isManualRuleSource(activeRow.source) ||
        !isManualRuleSource(overRow.source) ||
        activeRow.source !== overRow.source ||
        activeRow.manualIndex === undefined ||
        overRow.manualIndex === undefined
      ) {
        return
      }

      const next = cloneManualRules(manualRules)
      next[activeRow.source] = arrayMove(
        next[activeRow.source],
        activeRow.manualIndex,
        overRow.manualIndex,
      )

      await saveManualRules(next)
    },
    [dragDisabled, manualRules, rows, saveManualRules],
  )

  return (
    <BasePage
      full
      title={t('rules.page.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<AddRounded />}
            onClick={(event) => setAddMenuAnchor(event.currentTarget)}
          >
            {t('rules.page.actions.add')}
          </Button>
          <ProviderButton />
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: '10px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <BaseSearchBox
          onSearch={(match, state: SearchState) => {
            setSearchText(state.text)
            setMatch(() => match)
          }}
        />
      </Box>

      <RuleTableHeader />

      {filteredRows.length > 0 ? (
        <>
          <Box
            ref={scrollContainerRef}
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedRowId(null)
              }
            }}
            onScroll={handleScroll}
            sx={{ flex: 1, overflow: 'auto' }}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filteredRows.map((row) => row.id)}
                strategy={verticalListSortingStrategy}
              >
                {filteredRows.map((row) => (
                  <RuleTableRow
                    key={row.id}
                    row={row}
                    selected={effectiveSelectedRowId === row.id}
                    dragDisabled={dragDisabled || row.source === 'runtime'}
                    onSelect={handleSelectRow}
                    onEdit={(row) => openRowDialog(row, 'edit')}
                    onContextMenu={handleContextMenu}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </Box>
          <ScrollTopButton onClick={scrollToTop} show={showScrollTop} />
        </>
      ) : (
        <BaseEmpty />
      )}

      <Menu
        anchorEl={addMenuAnchor}
        open={Boolean(addMenuAnchor)}
        onClose={() => setAddMenuAnchor(null)}
      >
        <MenuItem onClick={() => openAddDialog('standard')}>
          <ListItemIcon>
            <PlaylistAddRounded fontSize="small" />
          </ListItemIcon>
          {t('rules.page.actions.standard')}
        </MenuItem>
        <MenuItem onClick={() => openAddDialog('logical')}>
          <ListItemIcon>
            <PlaylistAddRounded fontSize="small" />
          </ListItemIcon>
          {t('rules.page.actions.logical')}
        </MenuItem>
        <MenuItem onClick={() => openAddDialog('ruleset')}>
          <ListItemIcon>
            <PlaylistAddRounded fontSize="small" />
          </ListItemIcon>
          {t('rules.page.actions.ruleset')}
        </MenuItem>
      </Menu>

      <Menu
        open={rowMenu !== null}
        onClose={() => setRowMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          rowMenu !== null
            ? { top: rowMenu.mouseY, left: rowMenu.mouseX }
            : undefined
        }
      >
        <MenuItem
          onClick={() => rowMenu?.row && openRowDialog(rowMenu.row, 'edit')}
        >
          <ListItemIcon>
            <EditRounded fontSize="small" />
          </ListItemIcon>
          {t('rules.page.actions.edit')}
        </MenuItem>
        <MenuItem
          onClick={() =>
            rowMenu?.row && openRowDialog(rowMenu.row, 'duplicate')
          }
        >
          <ListItemIcon>
            <ContentCopyRounded fontSize="small" />
          </ListItemIcon>
          {t('rules.page.actions.duplicate')}
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => rowMenu?.row && applyDelete(rowMenu.row)}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteRounded color="error" fontSize="small" />
          </ListItemIcon>
          {t('rules.page.actions.delete')}
        </MenuItem>
      </Menu>

      <RuleEditorDialog
        open={dialogOpen}
        mode={dialogMode}
        kind={dialogKind}
        form={form}
        policyOptionGroups={policyOptionGroups}
        providerOptions={providerOptions}
        onClose={() => setDialogOpen(false)}
        onChange={setForm}
        onSubmit={handleSubmitDialog}
      />
    </BasePage>
  )
}

export default RulesPage
