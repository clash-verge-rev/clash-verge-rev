import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import * as yaml from 'js-yaml'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppRefreshers } from '@/providers/app-data-context'
import { getProfiles, readProfileFile, saveProfileFile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { parseYamlSafe } from '@/utils/yaml'

import {
  addDomainRule,
  buildDomainRule,
  isDomainName,
  normalizeDomain,
  type DomainRuleType,
} from './connection-domain-rule'

export interface DomainRuleTarget {
  host: string
  profileUid: string
  rulesUid: string
  profileName?: string
}

interface Props {
  target: DomainRuleTarget
  activeProfileUid?: string
  activeRulesUid?: string
  proxyPolicies: string[]
  clashMode?: string
  onClose: () => void
}

const builtinProxyPolicies = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS']

export const AddDomainRuleDialog = ({
  target,
  activeProfileUid,
  activeRulesUid,
  proxyPolicies,
  clashMode,
  onClose,
}: Props) => {
  const { t } = useTranslation()
  const { refreshRules } = useAppRefreshers()
  const [ruleType, setRuleType] = useState<DomainRuleType>('DOMAIN')
  const [domain, setDomain] = useState(() => normalizeDomain(target.host))
  const [policy, setPolicy] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const policies = useMemo(
    () => [...new Set([...builtinProxyPolicies, ...proxyPolicies])],
    [proxyPolicies],
  )
  const normalizedDomain = normalizeDomain(domain)
  const profileChanged =
    !!target &&
    (target.profileUid !== activeProfileUid ||
      target.rulesUid !== activeRulesUid)
  const canSave =
    !!target.rulesUid &&
    isDomainName(normalizedDomain) &&
    policies.includes(policy) &&
    !profileChanged

  const handleSave = useLockFn(async () => {
    if (!canSave) return
    setError(null)
    setIsSaving(true)
    try {
      const isTargetCurrent = async () => {
        const profiles = await getProfiles()
        const profile = profiles.items?.find(
          (item) => item.uid === profiles.current,
        )
        return (
          profiles.current === target.profileUid &&
          profile?.option?.rules === target.rulesUid
        )
      }

      if (profileChanged || !(await isTargetCurrent())) {
        throw new Error(
          t('connections.modals.addDomainRule.errors.profileChanged'),
        )
      }

      const data = await readProfileFile(target.rulesUid)
      const parsed = parseYamlSafe(data)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(
          t('connections.modals.addDomainRule.errors.invalidRules'),
        )
      }

      const source = parsed as Record<string, unknown>
      const readSequence = (key: 'prepend' | 'append' | 'delete') => {
        const value = source[key]
        if (value === undefined) return []
        if (
          !Array.isArray(value) ||
          !value.every((item): item is string => typeof item === 'string')
        ) {
          throw new Error(
            t('connections.modals.addDomainRule.errors.invalidRules'),
          )
        }
        return value
      }
      const prepend = readSequence('prepend')
      const append = readSequence('append')
      readSequence('delete')
      const rule = buildDomainRule(ruleType, normalizedDomain, policy)
      const next = addDomainRule(prepend, append, rule)
      const nextData = yaml.dump(
        { ...source, prepend: next.prepend, append: next.append },
        { forceQuotes: true },
      )

      if (!(await isTargetCurrent())) {
        throw new Error(
          t('connections.modals.addDomainRule.errors.profileChanged'),
        )
      }
      if (!(await saveProfileFile(target.rulesUid, nextData))) {
        throw new Error(t('connections.modals.addDomainRule.errors.saveFailed'))
      }
      if (!(await isTargetCurrent())) {
        throw new Error(
          t('connections.modals.addDomainRule.errors.profileChanged'),
        )
      }
      await refreshRules()
      showNotice.success('shared.feedback.notifications.saved')
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showNotice.error(message)
    } finally {
      setIsSaving(false)
    }
  })

  return (
    <Dialog
      open
      onClose={() => {
        if (!isSaving) onClose()
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{t('connections.modals.addDomainRule.title')}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}
      >
        {target?.profileName && (
          <Alert severity="info">
            {t('connections.modals.addDomainRule.profile', {
              name: target.profileName,
            })}
          </Alert>
        )}
        {clashMode && clashMode !== 'rule' && (
          <Alert severity="warning">
            {t('connections.modals.addDomainRule.nonRuleMode')}
          </Alert>
        )}
        {profileChanged && (
          <Alert severity="warning">
            {t('connections.modals.addDomainRule.errors.profileChanged')}
          </Alert>
        )}
        {!target?.rulesUid && (
          <Alert severity="warning">
            {t('connections.modals.addDomainRule.errors.noRulesFile')}
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          select
          size="small"
          label={t('connections.modals.addDomainRule.type')}
          value={ruleType}
          onChange={(event) =>
            setRuleType(event.target.value as DomainRuleType)
          }
          disabled={isSaving}
        >
          <MenuItem value="DOMAIN">DOMAIN</MenuItem>
          <MenuItem value="DOMAIN-SUFFIX">DOMAIN-SUFFIX</MenuItem>
        </TextField>
        <TextField
          size="small"
          label={t('connections.modals.addDomainRule.domain')}
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          disabled={isSaving}
          error={domain.length > 0 && !isDomainName(normalizedDomain)}
          helperText={
            domain.length > 0 && !isDomainName(normalizedDomain)
              ? t('connections.modals.addDomainRule.errors.invalidDomain')
              : undefined
          }
          autoFocus
        />
        <TextField
          select
          size="small"
          label={t('connections.modals.addDomainRule.policy')}
          value={policy}
          onChange={(event) => setPolicy(event.target.value)}
          disabled={isSaving}
          slotProps={{
            select: { displayEmpty: true },
            inputLabel: { shrink: true },
          }}
        >
          <MenuItem value="" disabled>
            {t('connections.modals.addDomainRule.selectPolicy')}
          </MenuItem>
          {policies.map((item) => (
            <MenuItem key={item} value={item}>
              {item}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label={t('connections.modals.addDomainRule.preview')}
          value={
            policy && isDomainName(normalizedDomain)
              ? `${ruleType},${normalizedDomain},${policy}`
              : ''
          }
          slotProps={{ input: { readOnly: true, disabled: isSaving } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>
          {t('shared.actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave || isSaving}
        >
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
