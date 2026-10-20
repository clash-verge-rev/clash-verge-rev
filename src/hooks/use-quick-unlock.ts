import { useCallback, useEffect, useRef, useState } from 'react'

import {
  checkMediaUnlockItem,
  getUnlockItems,
  type UnlockItem,
} from '@/services/cmds'

const QUICK_UNLOCK_STORAGE_KEY = 'clash_verge_quick_unlock_targets'
const UNLOCK_RESULTS_STORAGE_KEY = 'clash_verge_unlock_results'
const QUICK_UNLOCK_NODE_RESULTS_STORAGE_KEY =
  'clash_verge_quick_unlock_node_results'
const DEFAULT_QUICK_UNLOCK_TARGETS = ['Gemini']

type NodeUnlockResults = Record<string, Record<string, UnlockItem>>

const TARGETS_CHANGE_EVENT = 'quick-unlock-targets-change'
const RESULTS_CHANGE_EVENT = 'quick-unlock-results-change'

export const normalizeUnlockName = (name: string) => name.trim().toLowerCase()

const getStoredQuickUnlockTargets = (): string[] => {
  try {
    const raw = localStorage.getItem(QUICK_UNLOCK_STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string')
      }
    }
  } catch (err) {
    console.error('Failed to parse quick unlock targets:', err)
  }
  return DEFAULT_QUICK_UNLOCK_TARGETS
}

const setStoredQuickUnlockTargets = (targets: string[]) => {
  try {
    localStorage.setItem(QUICK_UNLOCK_STORAGE_KEY, JSON.stringify(targets))
    window.dispatchEvent(
      new CustomEvent(TARGETS_CHANGE_EVENT, { detail: targets }),
    )
  } catch (err) {
    console.error('Failed to save quick unlock targets:', err)
  }
}

const getStoredUnlockResults = (): Record<string, UnlockItem> => {
  try {
    const raw = localStorage.getItem(UNLOCK_RESULTS_STORAGE_KEY)
    if (raw) {
      const items = JSON.parse(raw) as UnlockItem[]
      if (Array.isArray(items)) {
        const record: Record<string, UnlockItem> = {}
        for (const item of items) {
          if (item?.name) {
            record[normalizeUnlockName(item.name)] = item
          }
        }
        return record
      }
    }
  } catch (err) {
    console.error('Failed to parse unlock results:', err)
  }
  return {}
}

const getStoredNodeUnlockResults = (): NodeUnlockResults => {
  try {
    const raw = localStorage.getItem(QUICK_UNLOCK_NODE_RESULTS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        return parsed as NodeUnlockResults
      }
    }
  } catch (err) {
    console.error('Failed to parse node unlock results:', err)
  }
  return {}
}

const saveUnlockResults = (updatedList: UnlockItem[]) => {
  try {
    const existing = getStoredUnlockResults()
    for (const item of updatedList) {
      existing[normalizeUnlockName(item.name)] = item
    }
    const mergedArray = Object.values(existing)
    localStorage.setItem(
      UNLOCK_RESULTS_STORAGE_KEY,
      JSON.stringify(mergedArray),
    )
    window.dispatchEvent(new CustomEvent(RESULTS_CHANGE_EVENT))
  } catch (err) {
    console.error('Failed to save unlock results:', err)
  }
}

const saveNodeUnlockResults = (
  proxyName: string,
  updatedItems: UnlockItem[],
) => {
  try {
    const all = getStoredNodeUnlockResults()
    const forNode = all[proxyName] || {}
    for (const item of updatedItems) {
      forNode[normalizeUnlockName(item.name)] = item
    }
    all[proxyName] = forNode
    localStorage.setItem(
      QUICK_UNLOCK_NODE_RESULTS_STORAGE_KEY,
      JSON.stringify(all),
    )
    window.dispatchEvent(new CustomEvent(RESULTS_CHANGE_EVENT))
  } catch (err) {
    console.error('Failed to save node unlock results:', err)
  }
}

let cachedAvailableTargets: string[] | null = null

export function useQuickUnlock(proxyName?: string) {
  const [pinnedTargets, setPinnedTargets] = useState<string[]>(
    getStoredQuickUnlockTargets,
  )
  const [results, setResults] = useState<Record<string, UnlockItem>>(
    getStoredUnlockResults,
  )
  const [nodeResults, setNodeResults] = useState<NodeUnlockResults>(
    getStoredNodeUnlockResults,
  )
  const [isTesting, setIsTesting] = useState(false)
  const [availableTargets, setAvailableTargets] = useState<string[]>(
    () => cachedAvailableTargets ?? [],
  )
  const testTokenRef = useRef(0)

  useEffect(() => {
    const handleTargetsChange = () => {
      setPinnedTargets(getStoredQuickUnlockTargets())
    }
    const handleResultsChange = () => {
      setResults(getStoredUnlockResults())
      setNodeResults(getStoredNodeUnlockResults())
    }

    window.addEventListener(TARGETS_CHANGE_EVENT, handleTargetsChange)
    window.addEventListener(RESULTS_CHANGE_EVENT, handleResultsChange)
    window.addEventListener('storage', handleTargetsChange)
    window.addEventListener('storage', handleResultsChange)

    return () => {
      window.removeEventListener(TARGETS_CHANGE_EVENT, handleTargetsChange)
      window.removeEventListener(RESULTS_CHANGE_EVENT, handleResultsChange)
      window.removeEventListener('storage', handleTargetsChange)
      window.removeEventListener('storage', handleResultsChange)
    }
  }, [])

  useEffect(() => {
    if (cachedAvailableTargets && cachedAvailableTargets.length > 0) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const items = await getUnlockItems()
        if (!cancelled && items && items.length > 0) {
          const names = items.map((i) => i.name)
          cachedAvailableTargets = names
          setAvailableTargets(names)
        }
      } catch (err) {
        console.error('Failed to load available unlock items:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const updatePinnedTargets = useCallback((targets: string[]) => {
    setStoredQuickUnlockTargets(targets)
    setPinnedTargets(targets)
  }, [])

  const toggleTarget = useCallback(
    (name: string) => {
      const current = getStoredQuickUnlockTargets()
      const exists = current.some(
        (t) => normalizeUnlockName(t) === normalizeUnlockName(name),
      )
      const next = exists
        ? current.filter(
            (t) => normalizeUnlockName(t) !== normalizeUnlockName(name),
          )
        : [...current, name]
      updatePinnedTargets(next)
    },
    [updatePinnedTargets],
  )

  const isPinned = useCallback(
    (name: string) => {
      return pinnedTargets.some(
        (t) => normalizeUnlockName(t) === normalizeUnlockName(name),
      )
    },
    [pinnedTargets],
  )

  const runQuickUnlock = useCallback(
    async (targetsToTest?: string[], targetProxyName?: string) => {
      const effectiveName = targetProxyName || proxyName
      const targets = targetsToTest ?? pinnedTargets
      if (!targets || targets.length === 0) {
        return
      }

      const token = ++testTokenRef.current
      try {
        setIsTesting(true)

        const testPromises = targets.map(async (target) => {
          try {
            return await checkMediaUnlockItem(target)
          } catch (err) {
            console.error(`Quick unlock check failed for ${target}:`, err)
            return {
              name: target,
              status: 'Failed',
            } as UnlockItem
          }
        })

        const resolved = await Promise.all(testPromises)
        if (token === testTokenRef.current) {
          if (effectiveName) {
            saveNodeUnlockResults(effectiveName, resolved)
            setNodeResults(getStoredNodeUnlockResults())
          }
          saveUnlockResults(resolved)
          setResults(getStoredUnlockResults())
        }
      } finally {
        if (token === testTokenRef.current) {
          setIsTesting(false)
        }
      }
    },
    [pinnedTargets, proxyName],
  )

  const activeResults = proxyName ? nodeResults[proxyName] || {} : results

  return {
    pinnedTargets,
    availableTargets,
    results: activeResults,
    isTesting,
    isPinned,
    setPinnedTargets: updatePinnedTargets,
    toggleTarget,
    runQuickUnlock,
  }
}
