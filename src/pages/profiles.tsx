import {
  DragDropProvider,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
} from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import {
  CheckBoxOutlineBlankRounded,
  CheckBoxRounded,
  ClearRounded,
  ContentPasteRounded,
  DeleteRounded,
  DragIndicatorRounded,
  FolderOpenRounded,
  IndeterminateCheckBoxRounded,
  LocalFireDepartmentRounded,
  RefreshRounded,
  TextSnippetOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Divider,
  Grid,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { TauriEvent } from '@tauri-apps/api/event'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useLockFn } from 'ahooks'
import { throttle } from 'lodash-es'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { closeAllConnections } from 'tauri-plugin-mihomo-api'

import {
  BasePage,
  BaseStyledTextField,
  SortableItem,
  type DialogRef,
} from '@/components/base'
import { GroupsManagerDialog } from '@/components/profile/groups-manager-dialog'
import { ProfileItem } from '@/components/profile/profile-item'
import { ProfileMore } from '@/components/profile/profile-more'
import {
  ProfileViewer,
  type ProfileViewerRef,
} from '@/components/profile/profile-viewer'
import { ConfigViewer } from '@/components/setting/mods/config-viewer'
import { useListen } from '@/hooks/use-listen'
import { fetchProfilesIntoCache, useProfiles } from '@/hooks/use-profiles'
import {
  useSubscriptionGroups,
  type ISubscriptionGroup,
} from '@/hooks/use-subscription-groups'
import {
  createProfile,
  deleteProfile,
  enhanceProfiles,
  getRuntimeLogs,
  importProfile,
  reorderProfile,
  updateProfile,
} from '@/services/cmds'
import { subscribeVergeEvents } from '@/services/events'
import { errorDetail, showNotice } from '@/services/notice-service'
import { revalidateQuery, useQuery } from '@/services/query-client'
import {
  useLoadingCache,
  useSetLoadingCache,
  useThemeMode,
} from '@/services/states'
import { debugLog } from '@/utils/debug'
import { isValidUrl } from '@/utils/network'

// 与 src-tauri/src/main.rs 的 worker_limit 上限(8)保持一致，避免前后端更新风暴不对齐
const PROFILE_UPDATE_WORKER_LIMIT = 8
const PROFILE_SWITCH_LOADING_DELAY = 400
const profilePointerSensor = PointerSensor.configure({
  activationConstraints: () => undefined,
})

interface ProfileSwitchRequest {
  profile: string
  notifySuccess: boolean
  force: boolean
}
// 记录profile切换状态
const debugProfileSwitch = (action: string, profile: string, extra?: any) => {
  const timestamp = new Date().toISOString().substring(11, 23)
  debugLog(`[Profile-Debug][${timestamp}] ${action}: ${profile}`, extra || '')
}

const SortableGroupItem = ({
  group,
  index,
  activeTab,
  setActiveTab,
}: {
  group: ISubscriptionGroup
  index: number
  activeTab: string
  setActiveTab: (tab: string) => void
}) => (
  <SortableItem id={group.id} index={index} group="subscription-groups">
    {({ ref, handleRef, style }) => (
      <ListItemButton
        ref={ref}
        style={style}
        selected={activeTab === group.id}
        onClick={() => setActiveTab(group.id)}
        sx={{
          borderRadius: '6px',
          mb: 0.5,
          position: 'relative',
          pl: 1,
          boxShadow: 'none !important',
          outline: 'none !important',
          '&:focus, &:active, &.Mui-focusVisible': {
            boxShadow: 'none !important',
            outline: 'none !important',
          },
        }}
      >
        <Box
          ref={handleRef}
          sx={{
            display: 'flex',
            alignItems: 'center',
            mr: 0.5,
            cursor: 'move',
            color: 'text.secondary',
            '&:hover': {
              color: 'text.primary',
            },
          }}
        >
          <DragIndicatorRounded sx={{ fontSize: '18px', cursor: 'move' }} />
        </Box>

        <ListItemText
          primary={
            <Typography noWrap variant="body2" sx={{ fontWeight: 500 }}>
              {group.name}
            </Typography>
          }
          secondary={
            group.remark ? (
              <Typography
                noWrap
                variant="caption"
                sx={{ display: 'block', opacity: 0.7 }}
              >
                {group.remark}
              </Typography>
            ) : undefined
          }
        />
        <Typography variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
          ({group.uids.length})
        </Typography>
      </ListItemButton>
    )}
  </SortableItem>
)

const ProfilePage = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const { addListener } = useListen()
  const [url, setUrl] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [profileDndRevision, setProfileDndRevision] = useState(0)
  const [activatings, setActivatings] = useState<string[]>([])
  const [switchTarget, setSwitchTarget] = useState<string | null>(null)
  const [visibleSwitchingProfile, setVisibleSwitchingProfile] = useState<
    string | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [timerUpdateRevisions, setTimerUpdateRevisions] = useState<
    Map<string, number>
  >(() => new Map())
  const [completedUpdateRevisions, setCompletedUpdateRevisions] = useState<
    Map<string, number>
  >(() => new Map())

  const { groups, setProfileGroup, reorderGroups, refetchGroups } =
    useSubscriptionGroups()
  const [activeTab, setActiveTab] = useState('all')
  const groupsManagerRef = useRef<DialogRef>(null)

  // Reset tab if active group is deleted
  useEffect(() => {
    if (activeTab !== 'all' && activeTab !== 'uncategorized') {
      const exists = groups.some((g) => g.id === activeTab)
      if (!exists) {
        queueMicrotask(() => {
          setActiveTab('all')
        })
      }
    }
  }, [groups, activeTab])

  // Batch selection states
  const [batchMode, setBatchMode] = useState(false)
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(
    () => new Set(),
  )

  // Profile 切换在前端串行执行；队列中只保留用户最后一次选择。
  const latestSwitchTargetRef = useRef<string | null>(null)
  const queuedSwitchRef = useRef<ProfileSwitchRequest | null>(null)
  const switchRunnerRef = useRef<Promise<void> | null>(null)
  const switchLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const currentProfileRef = useRef<string | undefined>(undefined)
  const profilePageMountedRef = useRef(true)
  const { current } = location.state || {}

  const {
    profiles = {},
    patchProfiles,
    mutateProfiles,
    error,
    isStale,
  } = useProfiles()

  useEffect(() => {
    currentProfileRef.current = profiles.current
  }, [profiles])

  useEffect(() => {
    const handleFileDrop = async () => {
      const unlisten = await addListener(
        TauriEvent.DRAG_DROP,
        async (event: any) => {
          const paths = event.payload.paths

          for (const file of paths) {
            if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
              showNotice.error('profiles.page.feedback.errors.onlyYaml')
              continue
            }
            const item = {
              type: 'local',
              name: file.split(/\/|\\/).pop() ?? 'New Profile',
              desc: '',
              url: '',
              option: {
                with_proxy: false,
                self_proxy: false,
              },
            } as IProfileItem
            const data = await readTextFile(file)
            await createProfile(item, data)
            await mutateProfiles()
          }
          await enhanceProfiles()
        },
      )

      return unlisten
    }

    const unsubscribe = handleFileDrop()

    return () => {
      unsubscribe.then((cleanup) => cleanup())
    }
  }, [addListener, mutateProfiles])

  const onEmergencyRefresh = useLockFn(async () => {
    debugLog('[紧急刷新] 开始强制刷新所有数据')

    try {
      await Promise.all([revalidateQuery(['getRuntimeLogs']), mutateProfiles()])

      await new Promise((resolve) => setTimeout(resolve, 500))
      await onEnhance(false)

      showNotice.success(
        'profiles.page.feedback.notices.forceRefreshCompleted',
        2000,
      )
    } catch (error) {
      console.error('[紧急刷新] 失败:', error)
      showNotice.error(
        'profiles.page.feedback.notices.emergencyRefreshFailed',
        { message: errorDetail(error) },
        4000,
      )
    }
  })

  const { data: chainLogs = {}, refetch: refetchLogs } = useQuery({
    queryKey: ['getRuntimeLogs'],
    queryFn: getRuntimeLogs,
  })
  const refetchLogsRef = useRef(refetchLogs)
  refetchLogsRef.current = refetchLogs
  const mutateLogs = useCallback(() => refetchLogsRef.current(), [])

  const viewerRef = useRef<ProfileViewerRef>(null)
  const configRef = useRef<DialogRef>(null)

  const profileItems = useMemo(() => {
    const items = profiles.items || []

    const type1 = ['local', 'remote']

    return items.filter((i) => i?.type && type1.includes(i.type))
  }, [profiles])

  const filteredProfileItems = useMemo(() => {
    if (activeTab === 'all') {
      return profileItems
    }
    if (activeTab === 'uncategorized') {
      const groupedUids = new Set(groups.flatMap((g) => g.uids))
      return profileItems.filter((item) => !groupedUids.has(item.uid))
    }
    const targetGroup = groups.find((g) => g.id === activeTab)
    if (!targetGroup) return []
    const groupUids = new Set(targetGroup.uids)
    const items = profileItems.filter((item) => groupUids.has(item.uid))

    return [...items].sort((a, b) => {
      const nameA = a.name || ''
      const nameB = b.name || ''

      const getSortCategory = (name: string) => {
        const first = name.trim().charAt(0)
        if (!first) return 5
        if (/[a-zA-Z]/.test(first)) return 3 // 字母
        if (/\d/.test(first)) return 2 // 数字
        if (/[\u4e00-\u9fa5]/.test(first)) return 4 // 汉字
        return 1 // 字符/符号
      }

      const catA = getSortCategory(nameA)
      const catB = getSortCategory(nameB)

      if (catA !== catB) {
        return catA - catB
      }

      const comp = nameA
        .trim()
        .toLowerCase()
        .localeCompare(nameB.trim().toLowerCase(), 'zh', {
          numeric: true,
        })
      if (comp !== 0) return comp
      return nameA.trim().localeCompare(nameB.trim())
    })
  }, [profileItems, activeTab, groups])

  const activeGroupName = useMemo(() => {
    if (activeTab !== 'all' && activeTab !== 'uncategorized') {
      return groups.find((g) => g.id === activeTab)?.name || ''
    }
    return ''
  }, [groups, activeTab])

  const uncategorizedCount = useMemo(() => {
    const groupedUids = new Set(groups.flatMap((g) => g.uids))
    return profileItems.filter((item) => !groupedUids.has(item.uid)).length
  }, [profileItems, groups])

  const currentActivatings = () => {
    return [...new Set([profiles.current ?? ''])].filter(Boolean)
  }

  const onImport = async () => {
    if (!url) return
    if (!isValidUrl(url)) {
      showNotice.error('profiles.page.feedback.errors.invalidUrl')
      return
    }
    setLoading(true)

    const handleImportSuccess = async (noticeKey: string) => {
      showNotice.success(noticeKey)
      setUrl('')
      await performRobustRefresh()
    }

    try {
      await importProfile(url)
      await handleImportSuccess('shared.feedback.notifications.importSuccess')
    } catch (initialErr) {
      console.warn('[订阅导入] 首次导入失败:', initialErr)

      const initialDetail = errorDetail(initialErr)
      if (initialDetail.toLowerCase().includes('legacy tls')) {
        showNotice.error(initialErr)
        return
      }

      showNotice.info('profiles.page.feedback.notifications.importRetry')
      try {
        await importProfile(url, {
          with_proxy: false,
          self_proxy: true,
        })
        await handleImportSuccess(
          'shared.feedback.notifications.importWithClashProxy',
        )
      } catch (retryErr) {
        showNotice.error(
          'profiles.page.feedback.notifications.importFail',
          retryErr,
        )
      }
    } finally {
      setDisabled(false)
      setLoading(false)
    }
  }

  // `useProfiles` already retries three times; add only one business-level retry.
  const performRobustRefresh = async () => {
    let retryCount = 0
    const maxRetries = 1
    const baseDelay = 200

    while (retryCount < maxRetries) {
      try {
        debugLog(`[导入刷新] 第${retryCount + 1}次尝试刷新配置数据`)

        await mutateProfiles()

        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * (retryCount + 1)),
        )

        await onEnhance(false)
        return
      } catch (error) {
        console.error(`[导入刷新] 第${retryCount + 1}次刷新失败:`, error)
        retryCount++
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * retryCount),
        )
      }
    }

    console.warn(`[导入刷新] 常规刷新失败，尝试清除缓存重新获取`)
    try {
      await fetchProfilesIntoCache()
      await onEnhance(false)
      showNotice.error(
        'profiles.page.feedback.notifications.importNeedsRefresh',
        3000,
      )
    } catch (finalError) {
      console.error(`[导入刷新] 最终刷新尝试失败:`, finalError)
      showNotice.error(
        'profiles.page.feedback.notifications.importSuccess',
        5000,
      )
    }
  }

  const onDragEnd = async (event: DragEndEvent) => {
    const { operation, canceled } = event
    const { source, target } = operation
    if (canceled || !target || !isSortable(source)) return

    const { index: newIndex, initialIndex: oldIndex } = source.sortable
    if (
      oldIndex < 0 ||
      newIndex < 0 ||
      oldIndex >= filteredProfileItems.length ||
      newIndex >= filteredProfileItems.length ||
      oldIndex === newIndex
    ) {
      return
    }

    const activeId = filteredProfileItems[oldIndex]?.uid
    const overId = filteredProfileItems[newIndex]?.uid
    if (activeId == null || overId == null || activeId === overId) return

    try {
      await reorderProfile(activeId, overId)
      mutateProfiles()
    } catch (error) {
      setProfileDndRevision((revision) => revision + 1)
      showNotice.error(error)
    }
  }

  const onGroupsDragEnd = async (event: DragEndEvent) => {
    const { operation, canceled } = event
    const { source, target } = operation
    if (canceled || !target || !isSortable(source)) return

    const { index: newIndex, initialIndex: oldIndex } = source.sortable
    if (
      oldIndex < 0 ||
      newIndex < 0 ||
      oldIndex >= groups.length ||
      newIndex >= groups.length ||
      oldIndex === newIndex
    ) {
      return
    }

    const activeId = groups[oldIndex]?.id
    const overId = groups[newIndex]?.id
    if (!activeId || !overId || activeId === overId) return

    await reorderGroups(activeId, overId)
  }

  const executeProfileSwitch = useCallback(
    async ({ profile, notifySuccess, force }: ProfileSwitchRequest) => {
      if (!force && currentProfileRef.current === profile) {
        debugProfileSwitch('ALREADY_CURRENT_IGNORED', profile)
        return
      }

      debugProfileSwitch('SWITCH_START', profile)

      try {
        const outcome = await patchProfiles({ current: profile })
        if (outcome.status === 'busy') {
          debugProfileSwitch('SWITCH_BUSY', profile)
          showNotice.info(
            'profiles.page.feedback.notifications.switchBusy',
            2000,
          )
          return
        }

        if (outcome.status === 'valid') {
          currentProfileRef.current = profile
          void mutateLogs().catch(() => {})
          void closeAllConnections().catch(() => {})

          if (
            notifySuccess &&
            latestSwitchTargetRef.current === profile &&
            queuedSwitchRef.current === null
          ) {
            showNotice.success(
              'profiles.page.feedback.notifications.profileSwitched',
              1000,
            )
          }
          debugProfileSwitch('SWITCH_SUCCESS', profile)
        } else {
          debugProfileSwitch('SWITCH_REJECTED', profile, outcome)
        }
      } catch (err: any) {
        console.error(`[Profile] 切换失败:`, err)
        showNotice.error(err, 4000)
      } finally {
        debugProfileSwitch('SWITCH_END', profile)
      }
    },
    [mutateLogs, patchProfiles],
  )

  const runProfileSwitchQueue = useCallback(async () => {
    while (profilePageMountedRef.current && queuedSwitchRef.current) {
      const request = queuedSwitchRef.current
      queuedSwitchRef.current = null
      await executeProfileSwitch(request)
    }
  }, [executeProfileSwitch])

  const activateProfile = useCallback(
    (profile: string, notifySuccess: boolean, force = false) => {
      if (!profilePageMountedRef.current) return Promise.resolve()

      if (
        !force &&
        currentProfileRef.current === profile &&
        switchRunnerRef.current === null
      ) {
        debugProfileSwitch('ALREADY_CURRENT_IGNORED', profile)
        return Promise.resolve()
      }

      if (
        latestSwitchTargetRef.current === profile &&
        switchRunnerRef.current
      ) {
        debugProfileSwitch('DUPLICATE_SWITCH_IGNORED', profile)
        return switchRunnerRef.current
      }

      latestSwitchTargetRef.current = profile
      queuedSwitchRef.current = { profile, notifySuccess, force }
      setSwitchTarget(profile)
      setVisibleSwitchingProfile(null)
      if (switchLoadingTimerRef.current) {
        window.clearTimeout(switchLoadingTimerRef.current)
      }
      switchLoadingTimerRef.current = window.setTimeout(() => {
        if (
          profilePageMountedRef.current &&
          latestSwitchTargetRef.current === profile
        ) {
          setVisibleSwitchingProfile(profile)
        }
      }, PROFILE_SWITCH_LOADING_DELAY)

      if (switchRunnerRef.current) {
        debugProfileSwitch('SWITCH_QUEUED', profile)
        return switchRunnerRef.current
      }

      const runner = runProfileSwitchQueue().finally(() => {
        if (switchRunnerRef.current === runner) {
          switchRunnerRef.current = null
          latestSwitchTargetRef.current = null
          if (switchLoadingTimerRef.current) {
            window.clearTimeout(switchLoadingTimerRef.current)
            switchLoadingTimerRef.current = null
          }
          if (profilePageMountedRef.current) {
            setSwitchTarget(null)
            setVisibleSwitchingProfile(null)
          }
        }
      })
      switchRunnerRef.current = runner
      return runner
    },
    [runProfileSwitchQueue],
  )

  const onSelect = async (profile: string, force: boolean) => {
    await activateProfile(profile, true, force)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (current) {
        await mutateProfiles()
        if (cancelled) return
        await activateProfile(current, false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [current, activateProfile, mutateProfiles])

  const onEnhance = useLockFn(async (notifySuccess: boolean) => {
    if (switchRunnerRef.current) {
      debugLog(
        `[Profile] 有profile正在切换中(${latestSwitchTargetRef.current})，跳过enhance操作`,
      )
      return
    }

    const currentProfiles = currentActivatings()
    setActivatings((prev) => [...new Set([...prev, ...currentProfiles])])

    try {
      if (!(await enhanceProfiles())) return
      mutateLogs()
      if (notifySuccess) {
        showNotice.success(
          'profiles.page.feedback.notifications.profileReactivated',
          1000,
        )
      }
    } catch (err: any) {
      showNotice.error(err, 3000)
    } finally {
      setActivatings([])
    }
  })

  const onDelete = useLockFn(async (uid: string) => {
    const current = profiles.current === uid
    try {
      setActivatings([...(current ? currentActivatings() : []), uid])
      // 1. 先从自定义分组文件中解除绑定关系
      await setProfileGroup(uid, null)
      // 2. 再调用系统原有的删除命令（执行系统自有的 profiles.yaml 标记/清理逻辑）
      await deleteProfile(uid)
      mutateProfiles()
      mutateLogs()
      if (current) {
        await onEnhance(false)
      }
    } catch (err: any) {
      showNotice.error(err)
    } finally {
      setActivatings([])
    }
  })

  const loadingCache = useLoadingCache()
  const setLoadingCache = useSetLoadingCache()
  const setLoadingProfiles = useCallback(
    (uids: string[], loading: boolean) => {
      setLoadingCache((cache) => {
        const next = new Set(cache)
        for (const uid of uids) {
          if (loading) {
            next.add(uid)
          } else {
            next.delete(uid)
          }
        }
        return next
      })
    },
    [setLoadingCache],
  )

  useEffect(
    () =>
      subscribeVergeEvents({
        'profile-update-started': ({ uid }) => {
          if (uid) setLoadingProfiles([uid], true)
        },
        'profile-update-completed': ({ uid }) => {
          if (!uid) return
          setLoadingProfiles([uid], false)
          setCompletedUpdateRevisions((current) => {
            const next = new Map(current)
            next.set(uid, (next.get(uid) ?? 0) + 1)
            return next
          })
          void mutateProfiles()
        },
        'verge://timer-updated': (uid) => {
          setTimerUpdateRevisions((current) => {
            const next = new Map(current)
            next.set(uid, (next.get(uid) ?? 0) + 1)
            return next
          })
        },
      }),
    [mutateProfiles, setLoadingProfiles],
  )

  const runProfileUpdates = useCallback(
    async (uids: string[]) => {
      if (uids.length === 0) return

      const throttleMutate = throttle(mutateProfiles, 2000, {
        trailing: true,
      })
      let cursor = 0

      const updateOne = async (uid: string) => {
        try {
          await updateProfile(uid)
          throttleMutate()
        } catch (err: any) {
          console.error(`更新订阅 ${uid} 失败:`, err)
        }
      }

      const worker = async () => {
        while (cursor < uids.length) {
          const uid = uids[cursor++]
          await updateOne(uid)
        }
      }

      try {
        const active = Math.min(PROFILE_UPDATE_WORKER_LIMIT, uids.length)
        await Promise.allSettled(Array.from({ length: active }, worker))
      } finally {
        setLoadingProfiles(uids, false)
        void mutateProfiles()
      }
    },
    [mutateProfiles, setLoadingProfiles],
  )
  const onUpdateAll = useLockFn(async () => {
    const items = profileItems.filter((e) => e.type === 'remote')
    const target = items
      .map((item) => item.uid)
      .filter((uid) => !loadingCache.has(uid))

    setLoadingProfiles(target, true)
    await runProfileUpdates(target)
  })

  // 更新当前活跃标签下的订阅
  const onUpdateActiveGroup = useLockFn(async () => {
    if (activeTab === 'all') {
      return onUpdateAll()
    }

    const uidsInGroup =
      activeTab === 'uncategorized'
        ? filteredProfileItems
            .filter((item) => item.type === 'remote')
            .map((item) => item.uid)
        : groups.find((g) => g.id === activeTab)?.uids || []

    const targetUids = uidsInGroup.filter((uid) => {
      const item = profileItems.find((p) => p.uid === uid)
      return item && item.type === 'remote' && !loadingCache.has(uid)
    })

    if (targetUids.length === 0) return

    setLoadingProfiles(targetUids, true)
    await runProfileUpdates(targetUids)
  })

  const onCopyLink = async () => {
    const text = await readText()
    if (text) setUrl(text)
  }

  const toggleBatchMode = () => {
    setBatchMode(!batchMode)
    if (!batchMode) {
      setSelectedProfiles(new Set())
    }
  }

  const toggleProfileSelection = (uid: string) => {
    setSelectedProfiles((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(uid)) {
        newSet.delete(uid)
      } else {
        newSet.add(uid)
      }
      return newSet
    })
  }

  const selectAllProfiles = () => {
    setSelectedProfiles(
      (prev) =>
        new Set([...prev, ...filteredProfileItems.map((item) => item.uid)]),
    )
  }

  const clearCurrentGroupSelections = () => {
    setSelectedProfiles((prev) => {
      const newSet = new Set(prev)
      filteredProfileItems.forEach((item) => newSet.delete(item.uid))
      return newSet
    })
  }

  const _clearAllSelections = () => {
    setSelectedProfiles(new Set())
  }

  const isAllSelected = () => {
    return (
      filteredProfileItems.length > 0 &&
      filteredProfileItems.every((item) => selectedProfiles.has(item.uid))
    )
  }

  const selectedCountInGroup = useMemo(() => {
    return filteredProfileItems.filter((item) => selectedProfiles.has(item.uid))
      .length
  }, [filteredProfileItems, selectedProfiles])

  const getSelectionState = () => {
    if (filteredProfileItems.length === 0) return 'none'

    if (selectedCountInGroup === 0) {
      return 'none' // 无选择
    } else if (selectedCountInGroup === filteredProfileItems.length) {
      return 'all' // 全选
    } else {
      return 'partial'
    }
  }

  const deleteSelectedProfiles = useLockFn(async () => {
    if (selectedCountInGroup === 0) return

    // 仅获取当前组内被勾选的订阅 UID
    const targetUids = filteredProfileItems
      .map((item) => item.uid)
      .filter((uid) => selectedProfiles.has(uid))

    try {
      // Get all currently activating profiles in targets
      const currentActivating =
        profiles.current && targetUids.includes(profiles.current)
          ? [profiles.current]
          : []

      setActivatings((prev) => [...new Set([...prev, ...currentActivating])])

      // Delete all target profiles in current group
      for (const uid of targetUids) {
        // 1. 先解绑分组
        await setProfileGroup(uid, null)
        // 2. 再调用系统原有的删除命令
        await deleteProfile(uid)
      }

      await mutateProfiles()
      await mutateLogs()

      if (currentActivating.length > 0) {
        await onEnhance(false)
      }

      // 从全局已选状态中清除已删除的 UID，并关闭批量模式
      setSelectedProfiles((prev) => {
        const next = new Set(prev)
        targetUids.forEach((uid) => next.delete(uid))
        return next
      })
      setBatchMode(false)

      showNotice.success('profiles.page.feedback.notifications.batchDeleted')
    } catch (err: any) {
      showNotice.error(err)
    } finally {
      setActivatings([])
    }
  })

  const mode = useThemeMode()
  const isLight = mode === 'light'
  const dividercolor = isLight
    ? 'rgba(0, 0, 0, 0.06)'
    : 'rgba(255, 255, 255, 0.06)'

  // 卸载后不再执行尚未发送的切换意图。
  useEffect(() => {
    profilePageMountedRef.current = true
    return () => {
      profilePageMountedRef.current = false
      queuedSwitchRef.current = null
      latestSwitchTargetRef.current = null
      if (switchLoadingTimerRef.current) {
        window.clearTimeout(switchLoadingTimerRef.current)
        switchLoadingTimerRef.current = null
      }
    }
  }, [])

  return (
    <BasePage
      full
      title={t('profiles.page.title')}
      contentStyle={{ height: '100%' }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {!batchMode ? (
            <>
              {/* Batch mode toggle button */}
              <IconButton
                size="small"
                color="inherit"
                title={t('profiles.page.batch.title')}
                onClick={toggleBatchMode}
              >
                <CheckBoxOutlineBlankRounded />
              </IconButton>

              <IconButton
                size="small"
                color="inherit"
                title={
                  activeTab === 'all'
                    ? t('profiles.page.actions.updateAll')
                    : activeTab === 'uncategorized'
                      ? '更新未分类订阅'
                      : `更新分组【${activeGroupName}】`
                }
                onClick={onUpdateActiveGroup}
              >
                <RefreshRounded />
              </IconButton>

              <IconButton
                size="small"
                color="inherit"
                title={t('profiles.page.actions.viewRuntimeConfig')}
                onClick={() => configRef.current?.open()}
              >
                <TextSnippetOutlined />
              </IconButton>

              <IconButton
                size="small"
                color="primary"
                title={t('profiles.page.actions.reactivate')}
                onClick={() => onEnhance(true)}
              >
                <LocalFireDepartmentRounded />
              </IconButton>

              {/* 故障检测和紧急恢复按钮 */}
              {(error || isStale) && (
                <IconButton
                  size="small"
                  color="warning"
                  title={t(
                    'profiles.page.feedback.tooltips.forceRefreshStaleData',
                  )}
                  onClick={onEmergencyRefresh}
                  sx={{
                    animation: 'pulse 2s infinite',
                    '@keyframes pulse': {
                      '0%': { opacity: 1 },
                      '50%': { opacity: 0.5 },
                      '100%': { opacity: 1 },
                    },
                  }}
                >
                  <ClearRounded />
                </IconButton>
              )}
            </>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton
                size="small"
                color="inherit"
                title={
                  isAllSelected()
                    ? t('profiles.page.batch.actions.deselectAll')
                    : t('profiles.page.batch.actions.selectAll')
                }
                onClick={
                  isAllSelected()
                    ? clearCurrentGroupSelections
                    : selectAllProfiles
                }
              >
                {getSelectionState() === 'all' ? (
                  <CheckBoxRounded />
                ) : getSelectionState() === 'partial' ? (
                  <IndeterminateCheckBoxRounded />
                ) : (
                  <CheckBoxOutlineBlankRounded />
                )}
              </IconButton>
              <IconButton
                size="small"
                color="error"
                title={t('profiles.page.batch.actions.delete')}
                onClick={deleteSelectedProfiles}
                disabled={selectedCountInGroup === 0}
              >
                <DeleteRounded />
              </IconButton>
              <Button size="small" variant="outlined" onClick={toggleBatchMode}>
                {t('profiles.page.batch.actions.done')}
              </Button>
              <Box
                sx={{ flex: 1, textAlign: 'right', color: 'text.secondary' }}
              >
                {t('profiles.page.batch.summary.selected')}{' '}
                {selectedCountInGroup} {t('profiles.page.batch.summary.items')}
              </Box>
            </Box>
          )}
        </Box>
      }
    >
      <Box
        sx={{
          display: 'flex',
          height: '100%',
          gap: 2,
          p: '10px',
          boxSizing: 'border-box',
        }}
      >
        {/* 左侧：侧边分组导航栏 */}
        <Box
          sx={{
            width: 200,
            flexShrink: 0,
            borderRight: 1,
            borderColor: dividercolor,
            pr: 2,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height: '100%',
          }}
        >
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, mb: 1, pl: 1, opacity: 0.8 }}
            >
              订阅分组
            </Typography>
            <List
              dense
              sx={{
                py: 0,
                '& .MuiListItemButton-root': {
                  borderRadius: '6px',
                  mb: 0.5,
                },
              }}
            >
              <ListItemButton
                selected={activeTab === 'all'}
                onClick={() => setActiveTab('all')}
              >
                <ListItemText primary="全部" />
                <Typography variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
                  ({profileItems.length})
                </Typography>
              </ListItemButton>
              <DragDropProvider
                sensors={[profilePointerSensor]}
                onDragEnd={onGroupsDragEnd}
              >
                {groups.map((group, index) => (
                  <SortableGroupItem
                    key={group.id}
                    index={index}
                    group={group}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                  />
                ))}
              </DragDropProvider>
              <ListItemButton
                selected={activeTab === 'uncategorized'}
                onClick={() => setActiveTab('uncategorized')}
              >
                <ListItemText primary="未分类" />
                <Typography variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
                  ({uncategorizedCount})
                </Typography>
              </ListItemButton>
            </List>
          </Box>

          <Button
            size="small"
            variant="outlined"
            startIcon={<FolderOpenRounded />}
            onClick={() => groupsManagerRef.current?.open()}
            sx={{ mt: 1, borderRadius: '6px', width: '100%', py: 1 }}
          >
            分组管理
          </Button>
        </Box>

        {/* 右侧：主操作与列表区 */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              mb: 1.5,
              height: '36px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <BaseStyledTextField
              value={url}
              variant="outlined"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                  return
                }
                if (!url || disabled || loading) {
                  return
                }
                event.preventDefault()
                void onImport()
              }}
              placeholder={t('profiles.page.importForm.placeholder')}
              slotProps={{
                input: {
                  sx: { pr: 1 },
                  endAdornment: !url ? (
                    <IconButton
                      size="small"
                      sx={{ p: 0.5 }}
                      title={t('profiles.page.importForm.actions.paste')}
                      onClick={onCopyLink}
                    >
                      <ContentPasteRounded fontSize="inherit" />
                    </IconButton>
                  ) : (
                    <IconButton
                      size="small"
                      sx={{ p: 0.5 }}
                      title={t('shared.actions.clear')}
                      onClick={() => setUrl('')}
                    >
                      <ClearRounded fontSize="inherit" />
                    </IconButton>
                  ),
                },
              }}
            />
            <Button
              disabled={!url || disabled}
              loading={loading}
              variant="contained"
              size="small"
              sx={{ borderRadius: '6px' }}
              onClick={onImport}
            >
              {t('profiles.page.actions.import')}
            </Button>
            <Button
              variant="contained"
              size="small"
              sx={{ borderRadius: '6px' }}
              onClick={() => viewerRef.current?.create()}
            >
              {t('shared.actions.new')}
            </Button>
          </Stack>

          <DragDropProvider
            key={profileDndRevision}
            sensors={[profilePointerSensor, KeyboardSensor]}
            onDragEnd={onDragEnd}
          >
            <Box
              sx={{
                flex: 1,
                overflowY: 'auto',
                pr: '4px',
              }}
            >
              <Box
                sx={{
                  mb: 1.5,
                  display: 'grid',
                  overflow: 'hidden',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: 1,
                  px: 0.5,
                }}
              >
                {filteredProfileItems.map((item, index) => (
                  <ProfileItem
                    key={item.uid}
                    id={item.uid}
                    index={index}
                    selected={(switchTarget ?? profiles.current) === item.uid}
                    activating={
                      activatings.includes(item.uid) ||
                      visibleSwitchingProfile === item.uid
                    }
                    itemData={item}
                    timerUpdateRevision={timerUpdateRevisions.get(item.uid) ?? 0}
                    completedUpdateRevision={
                      completedUpdateRevisions.get(item.uid) ?? 0
                    }
                    mutateProfiles={mutateProfiles}
                    onSelect={(f) => onSelect(item.uid, f)}
                    onEdit={() => viewerRef.current?.edit(item)}
                    onSave={async (prev, curr) => {
                      if (prev !== curr && profiles.current === item.uid) {
                        await onEnhance(false)
                      }
                    }}
                    onDelete={() => {
                      if (batchMode) {
                        toggleProfileSelection(item.uid)
                      } else {
                        onDelete(item.uid)
                      }
                    }}
                    batchMode={batchMode}
                    isSelected={selectedProfiles.has(item.uid)}
                    onSelectionChange={() => toggleProfileSelection(item.uid)}
                  />
                ))}
              </Box>
              <Divider
                variant="middle"
                flexItem
                sx={{ width: `calc(100% - 32px)`, borderColor: dividercolor }}
              ></Divider>
              <Box sx={{ mt: 1.5, mb: '10px' }}>
                <Grid container spacing={{ xs: 1, lg: 1 }}>
                  <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }}>
                    <ProfileMore
                      id="Merge"
                      onSave={async (prev, curr) => {
                        if (prev !== curr) {
                          await onEnhance(false)
                        }
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }}>
                    <ProfileMore
                      id="Script"
                      logInfo={chainLogs['Script']}
                      onSave={async (prev, curr) => {
                        if (prev !== curr) {
                          await onEnhance(false)
                        }
                      }}
                    />
                  </Grid>
                </Grid>
              </Box>
            </Box>
          </DragDropProvider>
        </Box>
      </Box>

      <ProfileViewer
        ref={viewerRef}
        onChange={async (isActivating) => {
          // await mutateProfiles 确保 profiles.items 刷新，再显式 refetchGroups
          // 避免 profileItems 与 groups 数据不同步导致分组内订阅列表为空
          await mutateProfiles()
          await refetchGroups()
          if (isActivating) {
            await onEnhance(false)
          }
        }}
      />
      <ConfigViewer ref={configRef} />
      <GroupsManagerDialog ref={groupsManagerRef} />
    </BasePage>
  )
}

export default ProfilePage