import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { getProfiles, readProfileFile, saveProfileFile } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'

import {
  getConnectionRuleTargets,
  getConnectionRules,
  isConnectionRuleDomain,
  findConnectionRule,
  saveConnectionRule,
  type ConnectionRuleKind,
} from './connection-rule'

export interface ConnectionRuleTarget {
  metadata: IConnectionsItem['metadata']
  profileUid: string
  profileName: string
  rulesUid: string
  preferredKind: ConnectionRuleKind
}

function getInitialKind(target: ConnectionRuleTarget) {
  const targets = getConnectionRuleTargets(target.metadata)
  return targets[target.preferredKind]
    ? target.preferredKind
    : ((['domain', 'process', 'source', 'destination'] as const).find(
        (kind) => targets[kind],
      ) ?? 'domain')
}

export function ConnectionRuleDialog({
  target,
  onClose,
}: {
  target: ConnectionRuleTarget
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { proxyView } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const targets = getConnectionRuleTargets(target.metadata)
  const [kind, setKind] = useState<ConnectionRuleKind>(() =>
    getInitialKind(target),
  )
  const [policy, setPolicy] = useState<string | null>(null)
  const [scope, setScope] = useState<'DOMAIN' | 'DOMAIN-SUFFIX'>('DOMAIN')
  const [domainValue, setDomainValue] = useState(targets.domain?.value ?? '')
  const [rules, setRules] = useState<string[] | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selected = targets[kind]
  const editingDomain = kind === 'domain' && scope === 'DOMAIN-SUFFIX'
  const invalidDomain =
    editingDomain &&
    !isConnectionRuleDomain(domainValue, targets.domain?.value ?? '')
  const condition = selected
    ? {
        type: kind === 'domain' ? scope : selected.type,
        value: editingDomain ? domainValue.trim() : selected.value,
      }
    : undefined
  const existing =
    rules && condition && !invalidDomain
      ? findConnectionRule(rules, condition)
      : undefined
  const modifying = Boolean(existing)
  const groups = proxyView
    ? proxyView.groups.length || !proxyView.global
      ? proxyView.groups
      : [proxyView.global]
    : []
  const policies = [
    ...new Set(['DIRECT', 'REJECT', ...groups.map((group) => group.name)]),
  ]

  const kindLabels = {
    domain: t('connections.ruleDialog.domain'),
    process: t('connections.components.fields.process'),
    source: t('connections.ruleDialog.sourceIp'),
    destination: t('connections.ruleDialog.destinationIp'),
  }

  const unavailablePolicy = Boolean(policy && !policies.includes(policy))
  const blocked = loading || saving || rules === null

  useEffect(() => {
    let cancelled = false
    readProfileFile(target.rulesUid)
      .then((content) => {
        const loadedRules = getConnectionRules(content)
        const ruleTargets = getConnectionRuleTargets(target.metadata)
        const initialKind = getInitialKind(target)
        const selectedTarget = ruleTargets[initialKind]
        const initial = selectedTarget
          ? (findConnectionRule(loadedRules, selectedTarget) ??
            (initialKind === 'domain'
              ? findConnectionRule(loadedRules, {
                  ...selectedTarget,
                  type: 'DOMAIN-SUFFIX',
                })
              : undefined))
          : undefined
        if (cancelled) return
        setRules(loadedRules)
        setPolicy(initial?.policy ?? null)
        setScope(initial?.type === 'DOMAIN-SUFFIX' ? 'DOMAIN-SUFFIX' : 'DOMAIN')
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [target, loadAttempt])

  const handleSave = useLockFn(async () => {
    if (
      blocked ||
      !condition ||
      invalidDomain ||
      !policy ||
      !policies.includes(policy)
    )
      return
    if (/[\r\n,]/u.test(condition.value) || /[\r\n,]/u.test(policy)) {
      setError(t('connections.ruleDialog.unsupportedValue'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await mutate(
        async () => {
          const checkProfile = async () => {
            const profiles = await getProfiles()
            const current = profiles.items?.find(
              (item) => item.uid === profiles.current,
            )
            if (
              profiles.current !== target.profileUid ||
              current?.option?.rules !== target.rulesUid
            ) {
              throw new Error(t('connections.ruleDialog.profileChanged'))
            }
          }
          await checkProfile()
          const content = await readProfileFile(target.rulesUid)
          const updated = saveConnectionRule(content, condition, policy)
          await checkProfile()
          return saveProfileFile(target.rulesUid, updated)
        },
        { id: `save-profile-file:${target.rulesUid}`, errorNotice: false },
      )
      if (!result.ok || !result.value) {
        setError(t('connections.ruleDialog.applyFailed'))
        return
      }
      showNotice.success('connections.ruleDialog.saved')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  })

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {t(
          modifying
            ? 'connections.ruleDialog.modifyTitle'
            : 'connections.ruleDialog.title',
        )}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            select
            fullWidth
            size="small"
            label={t('connections.ruleDialog.matchBy')}
            value={kind}
            disabled={blocked}
            onChange={(event) => {
              const next = event.target.value as ConnectionRuleKind
              const nextTarget = targets[next]
              const rule =
                rules && nextTarget
                  ? (findConnectionRule(rules, nextTarget) ??
                    (next === 'domain'
                      ? findConnectionRule(rules, {
                          ...nextTarget,
                          type: 'DOMAIN-SUFFIX',
                        })
                      : undefined))
                  : undefined
              setDomainValue(targets.domain?.value ?? '')
              setKind(next)
              setPolicy(rule?.policy ?? null)
              setScope(
                rule?.type === 'DOMAIN-SUFFIX' ? 'DOMAIN-SUFFIX' : 'DOMAIN',
              )
            }}
          >
            {(['domain', 'process', 'source', 'destination'] as const).map(
              (option) => (
                <MenuItem
                  key={option}
                  value={option}
                  disabled={!targets[option]}
                >
                  {kindLabels[option]}
                  {!targets[option] &&
                    ` · ${t('connections.ruleDialog.unavailable')}`}
                </MenuItem>
              ),
            )}
          </TextField>
          {kind === 'process' ? (
            <>
              {target.metadata.process?.trim() && (
                <TextField
                  fullWidth
                  size="small"
                  label={kindLabels.process}
                  value={target.metadata.process}
                  slotProps={{
                    input: { readOnly: true },
                    htmlInput: { title: target.metadata.process },
                  }}
                />
              )}
              {selected?.type === 'PROCESS-PATH' && (
                <TextField
                  fullWidth
                  size="small"
                  label={t('connections.ruleDialog.fullPath')}
                  value={selected.value}
                  slotProps={{
                    input: { readOnly: true },
                    htmlInput: { title: selected.value },
                  }}
                />
              )}
            </>
          ) : (
            <TextField
              fullWidth
              size="small"
              label={
                editingDomain
                  ? t('connections.ruleDialog.matchingDomain')
                  : kindLabels[kind]
              }
              value={editingDomain ? domainValue : (selected?.value ?? '')}
              disabled={editingDomain && blocked}
              onChange={(event) => {
                const value = event.target.value
                setDomainValue(value)
                const match =
                  rules &&
                  isConnectionRuleDomain(value, targets.domain?.value ?? '')
                    ? findConnectionRule(rules, {
                        type: 'DOMAIN-SUFFIX',
                        value: value.trim(),
                      })
                    : undefined
                if (match) setPolicy(match.policy)
              }}
              error={invalidDomain}
              helperText={
                editingDomain ? (
                  <>
                    {t('connections.ruleDialog.connectionHost', {
                      host: targets.domain?.value,
                    })}
                    {invalidDomain && (
                      <>
                        <br />
                        {t('connections.ruleDialog.invalidDomain')}
                      </>
                    )}
                  </>
                ) : undefined
              }
              slotProps={{
                input: { readOnly: !editingDomain },
                htmlInput: {
                  title: editingDomain ? domainValue : selected?.value,
                },
              }}
            />
          )}
        </Box>
        {kind === 'domain' && (
          <RadioGroup
            row
            aria-label={t('connections.ruleDialog.domainScope')}
            value={scope}
            onChange={(_, value) => {
              const nextScope = value as 'DOMAIN' | 'DOMAIN-SUFFIX'
              setScope(nextScope)
              setDomainValue(targets.domain?.value ?? '')
              const match =
                rules && targets.domain
                  ? findConnectionRule(rules, {
                      ...targets.domain,
                      type: nextScope,
                    })
                  : undefined
              setPolicy(match?.policy ?? null)
            }}
            sx={{ mt: 0.5 }}
          >
            <FormControlLabel
              value="DOMAIN"
              control={<Radio size="small" />}
              disabled={blocked}
              label={t('connections.ruleDialog.exactDomain')}
            />
            <FormControlLabel
              value="DOMAIN-SUFFIX"
              control={<Radio size="small" />}
              disabled={blocked}
              label={t('connections.ruleDialog.allSubdomains')}
            />
          </RadioGroup>
        )}
        {(kind === 'source' || kind === 'destination') && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t(
              kind === 'source'
                ? 'connections.ruleDialog.sourceHint'
                : 'connections.ruleDialog.destinationHint',
            )}
          </Typography>
        )}
        {kind === 'process' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {selected?.type === 'PROCESS-PATH'
              ? t('connections.ruleDialog.processPathHint')
              : t('connections.ruleDialog.processNameHint')}
          </Typography>
        )}
        <Autocomplete
          size="small"
          options={
            unavailablePolicy && policy ? [policy, ...policies] : policies
          }
          getOptionLabel={(value) =>
            value === 'DIRECT'
              ? t('proxies.components.enums.policies.DIRECT')
              : value === 'REJECT'
                ? t('proxies.components.enums.policies.REJECT')
                : value
          }
          getOptionDisabled={(value) => !policies.includes(value)}
          value={policy}
          onChange={(_, value) => setPolicy(value)}
          disabled={blocked}
          loading={loading}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('rules.modals.editor.form.labels.proxyPolicy')}
              margin="normal"
              error={unavailablePolicy}
              helperText={
                unavailablePolicy
                  ? t('connections.ruleDialog.policyUnavailable')
                  : undefined
              }
            />
          )}
        />
        {clashConfig && clashConfig.mode !== 'rule' && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('connections.ruleDialog.ruleModeHint')}
          </Alert>
        )}
        {error && (
          <Box sx={{ mt: 2 }}>
            <Alert severity="error">
              {error}
              {rules === null && (
                <Button
                  onClick={() => {
                    setLoading(true)
                    setError('')
                    setLoadAttempt((attempt) => attempt + 1)
                  }}
                >
                  {t('shared.actions.retry')}
                </Button>
              )}
            </Alert>
          </Box>
        )}
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 2, overflowWrap: 'anywhere' }}
        >
          {t(
            modifying
              ? 'connections.ruleDialog.editDestination'
              : 'connections.ruleDialog.destination',
            {
              name: target.profileName,
            },
          )}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block' }}
        >
          {t('connections.ruleDialog.newConnections')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button disabled={saving} onClick={onClose}>
          {t('shared.actions.cancel')}
        </Button>
        <Button
          variant="contained"
          loading={saving}
          disabled={
            blocked ||
            !condition ||
            invalidDomain ||
            !policy ||
            !policies.includes(policy)
          }
          onClick={handleSave}
        >
          {t(
            modifying
              ? 'connections.ruleDialog.saveAndApply'
              : 'connections.ruleDialog.addAndApply',
          )}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
