import { join } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useMemo } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import { getAppDir } from '@/services/cmds'
import { useQuery } from '@/services/query-client'

export interface ISubscriptionGroup {
  id: string
  name: string
  remark?: string
  uids: string[]
}

export interface ISubscriptionGroupsConfig {
  groups: ISubscriptionGroup[]
}

const getFilePath = async () => {
  const appDir = await getAppDir()
  return await join(appDir, 'subscription_groups.json')
}

const getSubscriptionGroups = async (): Promise<ISubscriptionGroupsConfig> => {
  try {
    const filePath = await getFilePath()
    if (await exists(filePath)) {
      const content = await readTextFile(filePath)
      const data = JSON.parse(content) as ISubscriptionGroupsConfig
      if (data && Array.isArray(data.groups)) {
        return data
      }
    }
  } catch (error) {
    console.error('[useSubscriptionGroups] Failed to read groups:', error)
  }
  return { groups: [] }
}

const saveSubscriptionGroups = async (data: ISubscriptionGroupsConfig) => {
  const filePath = await getFilePath()
  await writeTextFile(filePath, JSON.stringify(data, null, 2))
}

export const useSubscriptionGroups = () => {
  const { profiles } = useProfiles()

  const validSet = useMemo(() => {
    return new Set(
      profiles?.items
        ?.filter(
          (item) =>
            item &&
            item.uid &&
            (item.type === 'local' || item.type === 'remote'),
        )
        .map((item) => item.uid) || [],
    )
  }, [profiles])

  const { data, refetch } = useQuery<ISubscriptionGroupsConfig>({
    queryKey: ['getSubscriptionGroups'],
    queryFn: () => getSubscriptionGroups(),
    refetchOnWindowFocus: false,
    staleTime: 500,
    placeholderData: { groups: [] },
  })

  const groups = data?.groups || []

  // 在主动进行写操作时，安全地过滤掉不在 validSet 里的历史无效死 UID（支持 allowUids 白名单豁免）
  const sanitizeGroups = (
    groupList: ISubscriptionGroup[],
    allowUids: string[] = [],
  ) => {
    if (!validSet || validSet.size === 0) return groupList
    const allowSet = new Set([...Array.from(validSet), ...allowUids])
    return groupList.map((g) => ({
      ...g,
      uids: g.uids.filter((uid) => allowSet.has(uid)),
    }))
  }

  const updateGroupsFile = async (
    newGroups: ISubscriptionGroup[],
    allowUids: string[] = [],
  ) => {
    const cleanGroups = sanitizeGroups(newGroups, allowUids)
    const config = { groups: cleanGroups }
    await saveSubscriptionGroups(config)
    await refetch()
  }

  const addGroup = async (name: string, remark?: string) => {
    const id = `group-${Date.now()}`
    const newGroup: ISubscriptionGroup = {
      id,
      name,
      remark,
      uids: [],
    }
    await updateGroupsFile([...groups, newGroup])
    return newGroup
  }

  const updateGroup = async (
    id: string,
    name: string,
    remark?: string,
    uids?: string[],
  ) => {
    const targetUids = uids || []
    const newGroups = groups.map((g) => {
      if (g.id === id) {
        return {
          ...g,
          name,
          remark,
          uids: targetUids,
        }
      }
      return {
        ...g,
        uids: g.uids.filter((uid) => !targetUids.includes(uid)),
      }
    })
    await updateGroupsFile(newGroups, targetUids)
  }

  const deleteGroup = async (id: string) => {
    const newGroups = groups.filter((g) => g.id !== id)
    await updateGroupsFile(newGroups)
  }

  const setProfileGroup = async (
    profileUid: string,
    groupId: string | null,
  ) => {
    const newGroups = groups.map((g) => {
      // 从其他组移除
      let uids = g.uids.filter((uid) => uid !== profileUid)
      // 如果是目标组，则加入
      if (g.id === groupId) {
        uids = [...uids, profileUid]
      }
      return { ...g, uids }
    })
    await updateGroupsFile(newGroups, [profileUid])
  }

  const reorderGroups = async (activeId: string, overId: string) => {
    const activeIndex = groups.findIndex((g) => g.id === activeId)
    const overIndex = groups.findIndex((g) => g.id === overId)
    if (activeIndex !== -1 && overIndex !== -1) {
      const newGroups = [...groups]
      const [removed] = newGroups.splice(activeIndex, 1)
      newGroups.splice(overIndex, 0, removed)
      await updateGroupsFile(newGroups)
    }
  }

  return {
    groups,
    addGroup,
    updateGroup,
    deleteGroup,
    setProfileGroup,
    reorderGroups,
    refetchGroups: refetch,
  }
}
