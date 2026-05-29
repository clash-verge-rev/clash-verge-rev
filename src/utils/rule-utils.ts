import yaml from 'js-yaml'

export type RuleSource = 'prepend' | 'runtime' | 'append'
export type ManualRuleSource = Exclude<RuleSource, 'runtime'>
export type RuleDialogKind = 'standard' | 'logical' | 'ruleset'

export interface ManualRulesDocument {
  prepend: string[]
  append: string[]
  delete: string[]
}

export interface ParsedRule {
  type: string
  value: string
  policy: string
  noResolve: boolean
}

export interface RuleForm {
  type: string
  value: string
  policy: string
  noResolve: boolean
}

export interface RulePresetRouteState {
  rulePreset?: {
    type?: string
    value?: string
    policy?: string
    noResolve?: boolean
  }
}

export interface RulePresetDialogState {
  kind: RuleDialogKind
  form: RuleForm
}

export interface LogicalRuleItem {
  id: string
  type: string
  value: string
  noResolve: boolean
}

interface RuleDedupEntry {
  list: string[]
  index: number
  noResolve: boolean
}

export const standardRuleTypes = [
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

export const logicalRuleTypes = ['AND', 'OR', 'NOT']
export const rulesetRuleTypes = ['RULE-SET']
export const logicalSubruleTypes = [
  ...standardRuleTypes.filter((type) => type !== 'MATCH'),
  ...logicalRuleTypes,
  ...rulesetRuleTypes,
]
export const networkRuleValues = ['TCP', 'UDP']

export const noResolveRuleTypes = new Set([
  'GEOIP',
  'IP-ASN',
  'IP-CIDR',
  'IP-CIDR6',
  'IP-SUFFIX',
  'RULE-SET',
])

export const ruleTypeExamples: Record<string, string> = {
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

export const runtimeRuleTypeMap: Record<string, string> = {
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

export const emptyManualRules = (): ManualRulesDocument => ({
  prepend: [],
  append: [],
  delete: [],
})

export const cloneManualRules = (
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

export const normalizeManualRules = (data: string): ManualRulesDocument => {
  const obj = yaml.load(data) as Partial<ManualRulesDocument> | null
  return {
    prepend: toStringArray(obj?.prepend),
    append: toStringArray(obj?.append),
    delete: toStringArray(obj?.delete),
  }
}

export const dumpManualRules = (document: ManualRulesDocument) =>
  yaml.dump(document, { forceQuotes: true })

export const parseRuleRaw = (raw: string): ParsedRule => {
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

export const normalizeRuleValue = (type: string, value: string): string => {
  const normalizedType = type.trim().toUpperCase()
  const trimmedValue = value.trim()

  if (isGeoipRule(normalizedType)) return trimmedValue.toUpperCase()
  if (normalizedType === 'NETWORK') return trimmedValue.toUpperCase()
  if (logicalRuleTypes.includes(normalizedType)) {
    return normalizeLogicalRuleValue(normalizedType, trimmedValue)
  }

  return trimmedValue
}

export const buildParsedRuleRaw = (rule: ParsedRule) => {
  const type = rule.type.trim().toUpperCase()
  const policy = rule.policy.trim()
  const value =
    type === 'MATCH' ? '' : normalizeRuleValue(type, rule.value.trim())
  const base = value ? `${type},${value},${policy}` : `${type},${policy}`

  return rule.noResolve && noResolveRuleTypes.has(type)
    ? `${base},no-resolve`
    : base
}

export const buildRuleRaw = (form: RuleForm) =>
  buildParsedRuleRaw({
    type: form.type,
    value: form.value,
    policy: form.policy,
    noResolve: form.noResolve,
  })

export const runtimeRuleToRaw = (rule: {
  type: string
  payload?: string | null
  proxy: string
}) => {
  const type = runtimeRuleTypeMap[rule.type] ?? rule.type.toUpperCase()
  const payload = rule.payload?.trim()

  return payload ? `${type},${payload},${rule.proxy}` : `${type},${rule.proxy}`
}

export const getRuleIdentitySignature = (rule: ParsedRule) =>
  [
    rule.type.trim().toUpperCase(),
    normalizeRuleValue(rule.type, rule.value),
    rule.policy.trim(),
  ].join('\n')

export const getRawRuleIdentitySignature = (raw: string) => {
  const parsed = parseRuleRaw(raw)
  return parsed.type && parsed.policy
    ? getRuleIdentitySignature(parsed)
    : raw.trim()
}

export const normalizeRuleRaw = (raw: string) => {
  const parsed = parseRuleRaw(raw)

  if (!parsed.type || !parsed.policy) return raw.trim()

  return buildParsedRuleRaw(parsed)
}

export const sanitizeRuleList = (
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

export const sanitizeManualRules = (
  document: ManualRulesDocument,
): ManualRulesDocument => {
  const manualSeen = new Map<string, RuleDedupEntry>()

  return {
    prepend: sanitizeRuleList(document.prepend, manualSeen),
    append: sanitizeRuleList(document.append, manualSeen),
    delete: sanitizeRuleList(document.delete),
  }
}

export const makeSearchText = (row: ParsedRule, source: string, raw: string) =>
  [row.type, row.value, row.policy, source, raw].join(' ')

export const removeAt = (
  list: string[],
  index?: number,
  fallbackRaw?: string,
) => {
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

export const replaceAt = (
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

export const insertAt = (
  list: string[],
  index: number | undefined,
  raw: string,
) => {
  const next = [...list]
  const safeIndex =
    typeof index === 'number' && index >= 0 && index <= next.length ? index : 0

  next.splice(safeIndex, 0, raw)
  return next
}

export const isManualRuleSource = (
  source: RuleSource,
): source is ManualRuleSource => source !== 'runtime'

export const addRuleDelete = (document: ManualRulesDocument, raw: string) => {
  const signature = getRawRuleIdentitySignature(raw)
  const exists = document.delete.some(
    (item) => getRawRuleIdentitySignature(item) === signature,
  )

  if (!exists) document.delete.push(raw)
}

export const revealRuntimeRuleIfUnshadowed = (
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

export const getTypeOptions = (kind: RuleDialogKind) => {
  if (kind === 'logical') return logicalRuleTypes
  if (kind === 'ruleset') return rulesetRuleTypes
  return standardRuleTypes
}

export const getKindFromType = (type: string): RuleDialogKind => {
  if (logicalRuleTypes.includes(type)) return 'logical'
  if (rulesetRuleTypes.includes(type)) return 'ruleset'
  return 'standard'
}

export const getDefaultRuleForm = (
  kind: RuleDialogKind,
  policy: string,
): RuleForm => ({
  type: getTypeOptions(kind)[0],
  value: '',
  policy,
  noResolve: false,
})

export const isGeoipRule = (type: string) =>
  type === 'GEOIP' || type === 'SRC-GEOIP'

export const normalizeRuleType = (type: string) => {
  const trimmedType = type.trim()
  return (
    runtimeRuleTypeMap[trimmedType] ??
    trimmedType.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toUpperCase()
  )
}

export const getRulePresetDialogState = (
  preset: RulePresetRouteState['rulePreset'],
  fallbackPolicy: string,
): RulePresetDialogState | null => {
  const presetType = preset?.type?.trim()
  if (!preset || !presetType) return null

  const type = normalizeRuleType(presetType)
  const kind = getKindFromType(type)
  const form = getDefaultRuleForm(kind, fallbackPolicy)

  return {
    kind,
    form: {
      ...form,
      type,
      value: preset.value ?? form.value,
      policy: preset.policy?.trim() || form.policy,
      noResolve: Boolean(preset.noResolve),
    },
  }
}

export const createLogicalRuleItemId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const createLogicalRuleItem = (
  type = 'DOMAIN',
  value = '',
): LogicalRuleItem => ({
  id: createLogicalRuleItemId(),
  type,
  value,
  noResolve: false,
})

const isWrappedByOuterParentheses = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return false

  let depth = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '(') depth += 1
    if (char === ')') depth -= 1

    if (depth < 0) return false
    if (depth === 0 && index < trimmed.length - 1) return false
  }

  return depth === 0
}

const stripOuterParentheses = (value: string) => {
  const trimmed = value.trim()
  return isWrappedByOuterParentheses(trimmed)
    ? trimmed.slice(1, -1).trim()
    : trimmed
}

const splitExpressionParts = (raw: string) => {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]

    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)

    if (char === ',' && depth === 0) {
      parts.push(raw.slice(start, index).trim())
      start = index + 1
    }
  }

  parts.push(raw.slice(start).trim())

  return parts.filter(Boolean)
}

const splitLogicalRuleItems = (value: string) => {
  const inner = stripOuterParentheses(value)
  if (!inner) return []
  if (!inner.includes('(')) return [inner]

  return splitExpressionParts(inner).map(stripOuterParentheses).filter(Boolean)
}

const splitLogicalExpressionItems = (type: string, value: string) => {
  const normalizedType = type.trim().toUpperCase()
  let inner = stripOuterParentheses(value)

  if (normalizedType === 'NOT') {
    if (inner.startsWith('!')) inner = inner.slice(1).trim()
    return inner ? [stripOuterParentheses(inner)] : []
  }

  const operator =
    normalizedType === 'AND' ? '&&' : normalizedType === 'OR' ? '||' : ''
  if (!operator || !inner.includes(operator)) return []

  const items: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]

    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)

    if (
      depth === 0 &&
      inner.slice(index, index + operator.length) === operator
    ) {
      items.push(stripOuterParentheses(inner.slice(start, index).trim()))
      start = index + operator.length
      index += operator.length - 1
    }
  }

  items.push(stripOuterParentheses(inner.slice(start).trim()))

  return items.filter(Boolean)
}

const getLogicalExpressionType = (raw: string) => {
  const inner = stripOuterParentheses(raw)
  if (inner.startsWith('!')) return 'NOT'

  let depth = 0
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]

    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)

    if (depth === 0) {
      if (inner.slice(index, index + 2) === '&&') return 'AND'
      if (inner.slice(index, index + 2) === '||') return 'OR'
    }
  }

  return ''
}

const parseLogicalRuleItemRaw = (raw: string): LogicalRuleItem | null => {
  const parts = splitExpressionParts(raw)
  const candidateType = normalizeRuleType(parts[0] ?? '')
  const hasExplicitRuleType =
    parts.length > 1 &&
    (standardRuleTypes.includes(candidateType) ||
      logicalRuleTypes.includes(candidateType) ||
      rulesetRuleTypes.includes(candidateType))

  const expressionType = hasExplicitRuleType
    ? ''
    : getLogicalExpressionType(raw)
  if (expressionType) {
    return {
      id: createLogicalRuleItemId(),
      type: expressionType,
      value: normalizeLogicalRuleValue(expressionType, raw),
      noResolve: false,
    }
  }

  const type = normalizeRuleType(parts.shift() ?? '')
  const noResolve = parts.at(-1)?.toLowerCase() === 'no-resolve'

  if (noResolve) parts.pop()
  if (!type) return null

  return {
    id: createLogicalRuleItemId(),
    type,
    value: parts.join(','),
    noResolve: noResolve && noResolveRuleTypes.has(type),
  }
}

export const parseLogicalRuleItems = (typeOrValue: string, value?: string) => {
  const type = value === undefined ? '' : typeOrValue
  const rawValue = value ?? typeOrValue
  const expressionItems = type
    ? splitLogicalExpressionItems(type, rawValue)
    : []
  const items = (
    expressionItems.length > 0
      ? expressionItems
      : splitLogicalRuleItems(rawValue)
  )
    .map(parseLogicalRuleItemRaw)
    .filter((item): item is LogicalRuleItem => Boolean(item))

  return items.length > 0 ? items : [createLogicalRuleItem()]
}

export const isLogicalRuleItemComplete = (item: LogicalRuleItem) => {
  const type = item.type.trim().toUpperCase()
  if (!type) return false

  return item.value.trim().length > 0
}

export const buildLogicalRuleItemRaw = (item: LogicalRuleItem): string => {
  const type = item.type.trim().toUpperCase()
  const value = normalizeRuleValue(type, item.value)
  const base = value ? `${type},${value}` : type

  return item.noResolve && noResolveRuleTypes.has(type)
    ? `${base},no-resolve`
    : base
}

export const buildLogicalRuleValue = (items: LogicalRuleItem[]): string => {
  const subrules = items
    .filter(isLogicalRuleItemComplete)
    .map((item) => `(${buildLogicalRuleItemRaw(item)})`)

  return subrules.length > 0 ? `(${subrules.join(',')})` : ''
}

export const normalizeLogicalRuleValue = (
  type: string,
  value: string,
): string => {
  const itemRaws = splitLogicalExpressionItems(type, value)
  const items = (itemRaws.length > 0 ? itemRaws : splitLogicalRuleItems(value))
    .map(parseLogicalRuleItemRaw)
    .filter((item): item is LogicalRuleItem => Boolean(item))

  if (items.length === 0) return value.trim()

  return buildLogicalRuleValue(items) || value.trim()
}
