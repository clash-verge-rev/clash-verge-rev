import { arrayMove } from '@dnd-kit/helpers'
import {
  DragDropProvider,
  PointerSensor,
  type DragEndEvent,
} from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { DragIndicatorRounded } from '@mui/icons-material'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
} from '@mui/material'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConnectionColumnOption {
  id: string
  label: string
  visible: boolean
  toggleVisibility: (visible: boolean) => void
}

interface Props {
  open: boolean
  columns: ConnectionColumnOption[]
  onClose: () => void
  onOrderChange: (order: string[]) => void
  onReset: () => void
}

export const ConnectionColumnManager = ({
  open,
  columns,
  onClose,
  onOrderChange,
  onReset,
}: Props) => {
  const { t } = useTranslation()

  const visibleCount = useMemo(
    () => columns.filter((column) => column.visible).length,
    [columns],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { operation, canceled } = event
      const { source, target } = operation
      if (canceled || !target || !isSortable(source)) return

      const order = columns.map((column) => column.id)
      const { index: newIndex, initialIndex: oldIndex } = source.sortable
      if (
        oldIndex < 0 ||
        newIndex < 0 ||
        oldIndex >= order.length ||
        newIndex >= order.length ||
        oldIndex === newIndex
      ) {
        return
      }

      onOrderChange(arrayMove(order, oldIndex, newIndex))
    },
    [columns, onOrderChange],
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t('connections.components.columnManager.title')}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <DragDropProvider sensors={[PointerSensor]} onDragEnd={handleDragEnd}>
          <List
            dense
            disablePadding
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {columns.map((column, index) => (
              <SortableColumnItem
                key={column.id}
                id={column.id}
                index={index}
                column={column}
                dragHandleLabel={t(
                  'connections.components.columnManager.dragHandle',
                )}
                disableToggle={column.visible && visibleCount <= 1}
              />
            ))}
          </List>
        </DragDropProvider>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={onReset}>
          {t('shared.actions.resetToDefault')}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t('shared.actions.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

interface SortableColumnItemProps {
  id: string
  index: number
  column: ConnectionColumnOption
  dragHandleLabel: string
  disableToggle?: boolean
}

const SortableColumnItem = ({
  id,
  index,
  column,
  dragHandleLabel,
  disableToggle = false,
}: SortableColumnItemProps) => {
  const [element, setElement] = useState<Element | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const { isDragging } = useSortable({
    id,
    index,
    element,
    handle: handleRef,
  })

  return (
    <ListItem
      ref={setElement}
      disableGutters
      sx={{
        px: 1,
        py: 0.5,
        borderRadius: 1,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        // 拖拽中的行置为不透明背景，避免透出下方内容；投影由全局 [data-dnd-dragging] 规则统一施加。
        backgroundColor: isDragging ? 'background.paper' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
      }}
    >
      <Checkbox
        edge="start"
        checked={column.visible}
        disabled={disableToggle}
        onChange={(event) => column.toggleVisibility(event.target.checked)}
      />
      <ListItemText
        primary={column.label}
        slotProps={{ primary: { variant: 'body2' } }}
        sx={{ mr: 1 }}
      />
      <IconButton
        edge="end"
        size="small"
        ref={handleRef}
        sx={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        aria-label={dragHandleLabel}
      >
        <DragIndicatorRounded fontSize="small" />
      </IconButton>
    </ListItem>
  )
}
