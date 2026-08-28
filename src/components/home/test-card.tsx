import {
  DragDropProvider,
  PointerSensor,
  type DragEndEvent,
} from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { Add, NetworkCheck } from '@mui/icons-material'
import { Box, IconButton, Tooltip, alpha, styled } from '@mui/material'
import { emit } from '@tauri-apps/api/event'
import { nanoid } from 'nanoid'
import { useEffect, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

// test icons
import apple from '@/assets/image/test/apple.svg?raw'
import github from '@/assets/image/test/github.svg?raw'
import google from '@/assets/image/test/google.svg?raw'
import youtube from '@/assets/image/test/youtube.svg?raw'
import { SortableItem } from '@/components/base'
import { TestItem } from '@/components/test/test-item'
import { TestViewer, type TestViewerRef } from '@/components/test/test-viewer'
import { useVerge } from '@/hooks/use-verge'

import { EnhancedCard } from './enhanced-card'

// 自定义滚动条样式
const ScrollBox = styled(Box)(({ theme }) => ({
  maxHeight: '180px',
  overflowY: 'auto',
  overflowX: 'hidden',
  '&::-webkit-scrollbar': {
    width: '6px',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: alpha(theme.palette.text.primary, 0.2),
    borderRadius: '3px',
  },
}))

// 默认测试列表，移到组件外部避免重复创建
const DEFAULT_TEST_LIST = [
  {
    uid: nanoid(),
    name: 'Apple',
    url: 'https://www.apple.com',
    icon: apple,
  },
  {
    uid: nanoid(),
    name: 'GitHub',
    url: 'https://www.github.com',
    icon: github,
  },
  {
    uid: nanoid(),
    name: 'Google',
    url: 'https://www.google.com',
    icon: google,
  },
  {
    uid: nanoid(),
    name: 'YouTube',
    url: 'https://www.youtube.com',
    icon: youtube,
  },
]

export const TestCard = () => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const viewerRef = useRef<TestViewerRef>(null)

  // 使用useMemo优化测试列表，避免每次渲染重新计算
  const testList = useMemo(() => {
    return verge?.test_list ?? DEFAULT_TEST_LIST
  }, [verge?.test_list])

  // 使用useCallback优化函数引用，避免不必要的重新渲染
  const onTestListItemChange = useCallback(
    (uid: string, patch?: Partial<IVergeTestItem>) => {
      if (!patch) {
        mutateVerge()
        return
      }

      const newList = testList.map((x) =>
        x.uid === uid ? { ...x, ...patch } : x,
      )

      mutateVerge({ ...verge, test_list: newList }, false)
    },
    [testList, verge, mutateVerge],
  )

  const onDeleteTestListItem = useCallback(
    (uid: string) => {
      const newList = testList.filter((x) => x.uid !== uid)
      patchVerge({ test_list: newList })
      mutateVerge({ ...verge, test_list: newList }, false)
    },
    [testList, verge, patchVerge, mutateVerge],
  )

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { operation, canceled } = event
      const { source, target } = operation

      if (canceled || !target || !isSortable(source)) return

      const { index: newIndex, initialIndex: oldIndex } = source.sortable
      if (
        oldIndex < 0 ||
        newIndex < 0 ||
        oldIndex >= testList.length ||
        newIndex >= testList.length ||
        oldIndex === newIndex
      ) {
        return
      }

      const activeId = testList[oldIndex].uid
      const overId = testList[newIndex].uid

      if (activeId == null || overId == null || activeId === overId) return

      const newList = [...testList]
      const [removed] = newList.splice(oldIndex, 1)
      newList.splice(newIndex, 0, removed)

      // 优化：先本地更新，再异步 patch，避免UI卡死
      mutateVerge({ ...verge, test_list: newList }, false)
      const patchFn = () => {
        try {
          patchVerge({ test_list: newList })
        } catch {}
      }
      if (window.requestIdleCallback) {
        window.requestIdleCallback(patchFn)
      } else {
        setTimeout(patchFn, 0)
      }
    },
    [testList, verge, mutateVerge, patchVerge],
  )

  // 仅在verge首次加载时初始化测试列表
  useEffect(() => {
    if (verge && !verge.test_list) {
      patchVerge({ test_list: DEFAULT_TEST_LIST })
    }
  }, [verge, patchVerge])

  // 使用useMemo优化UI内容，减少渲染计算
  const renderTestItems = useMemo(
    () => (
      <Box
        sx={{
          mb: 1.5,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
          gap: 1,
          px: 1,
        }}
      >
        {testList.map((item, index) => (
          <SortableItem key={item.uid} id={item.uid} index={index}>
            <TestItem
              itemData={item}
              onEdit={() => viewerRef.current?.edit(item)}
              onDelete={onDeleteTestListItem}
            />
          </SortableItem>
        ))}
      </Box>
    ),
    [testList, onDeleteTestListItem],
  )

  const handleTestAll = useCallback(() => {
    emit('verge://test-all')
  }, [])

  const handleCreateTest = useCallback(() => {
    viewerRef.current?.create()
  }, [])

  return (
    <EnhancedCard
      title={t('home.components.tests.title')}
      icon={<NetworkCheck />}
      action={
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title={t('tests.page.actions.testAll')} arrow>
            <IconButton size="small" onClick={handleTestAll}>
              <NetworkCheck fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('tests.modals.test.title.create')} arrow>
            <IconButton size="small" onClick={handleCreateTest}>
              <Add fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      }
    >
      <ScrollBox>
        <DragDropProvider sensors={[PointerSensor]} onDragEnd={onDragEnd}>
          {renderTestItems}
        </DragDropProvider>
      </ScrollBox>

      <TestViewer ref={viewerRef} onChange={onTestListItemChange} />
    </EnhancedCard>
  )
}
