import {
  DragDropProvider,
  PointerSensor,
  type DragEndEvent,
} from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { Add, NetworkCheck, Tune } from '@mui/icons-material'
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
  alpha,
  styled,
} from '@mui/material'
import { useState, useRef, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SortableItem } from '@/components/base'
import { TestItem } from '@/components/test/test-item'
import { TestPresetsDialog } from '@/components/test/test-presets-dialog'
import { TestViewer, type TestViewerRef } from '@/components/test/test-viewer'
import { useVerge } from '@/hooks/use-verge'
import { emitTestAll } from '@/services/bus'
import { DEFAULT_TEST_LIST } from '@/utils/test-presets'

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

export const TestCard = () => {
  const { t } = useTranslation()
  const { verge, mutateVerge, patchVerge } = useVerge()
  const viewerRef = useRef<TestViewerRef>(null)
  const [presetsOpen, setPresetsOpen] = useState(false)

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
          <SortableItem key={item.uid} id={item.uid!} index={index}>
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
    emitTestAll()
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
            <IconButton
              size="small"
              onClick={handleTestAll}
              aria-label={t('tests.page.actions.testAll')}
            >
              <NetworkCheck fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('tests.presets.title')} arrow>
            <IconButton
              size="small"
              onClick={() => setPresetsOpen(true)}
              aria-label={t('tests.presets.title')}
            >
              <Tune fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('tests.modals.test.title.create')} arrow>
            <IconButton
              size="small"
              onClick={handleCreateTest}
              aria-label={t('tests.modals.test.title.create')}
            >
              <Add fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      }
    >
      <ScrollBox>
        {testList.length === 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: 'center', py: 3 }}
          >
            {t('tests.presets.empty')}
          </Typography>
        )}
        <DragDropProvider sensors={[PointerSensor]} onDragEnd={onDragEnd}>
          {renderTestItems}
        </DragDropProvider>
      </ScrollBox>

      <TestViewer ref={viewerRef} onChange={onTestListItemChange} />
      {presetsOpen && (
        <TestPresetsDialog
          testList={testList}
          onClose={() => setPresetsOpen(false)}
        />
      )}
    </EnhancedCard>
  )
}
