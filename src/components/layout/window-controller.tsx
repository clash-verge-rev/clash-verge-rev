import { Close, CropSquare, FilterNone, Minimize } from '@mui/icons-material'
import { Box, IconButton } from '@mui/material'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
} from 'react'

import getSystem from '@/utils/get-system'

const RESIZE_HANDLES = [
  { direction: 'North', position: 'north' },
  { direction: 'NorthEast', position: 'north-east' },
  { direction: 'East', position: 'east' },
  { direction: 'SouthEast', position: 'south-east' },
  { direction: 'South', position: 'south' },
  { direction: 'SouthWest', position: 'south-west' },
  { direction: 'West', position: 'west' },
  { direction: 'NorthWest', position: 'north-west' },
] as const

export const WindowResizeHandles = ({ maximized }: { maximized: boolean }) => {
  const startResizeDragging = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return

      event.preventDefault()
      const direction = event.currentTarget.dataset.resizeDirection
      const handle = RESIZE_HANDLES.find((item) => item.direction === direction)

      if (handle) {
        void getCurrentWindow()
          .startResizeDragging(handle.direction)
          .catch((error) =>
            console.warn('[WindowResizeHandles] 调整窗口大小失败:', error),
          )
      }
    },
    [],
  )

  if (getSystem() !== 'linux' || maximized) return null

  return (
    <div
      className="window-resize-handles"
      data-tauri-drag-region="false"
      aria-hidden="true"
    >
      {RESIZE_HANDLES.map(({ direction, position }) => (
        <div
          key={direction}
          className={`window-resize-handle window-resize-handle--${position}`}
          data-resize-direction={direction}
          onPointerDown={startResizeDragging}
        />
      ))}
    </div>
  )
}

export const WindowControls = ({
  maximized,
  setMaximized,
}: {
  maximized: boolean
  setMaximized: (value: boolean) => void
}) => {
  const OS = getSystem()

  const close = useCallback(async () => {
    // Delay one frame so the UI can clear :hover before the window hides.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await getCurrentWindow().close()
  }, [])

  const minimize = useCallback(async () => {
    // Delay one frame so the UI can clear :hover before the window hides.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await getCurrentWindow().minimize()
  }, [])

  const toggleMaximize = useCallback(async () => {
    const currentWindow = getCurrentWindow()
    if (await currentWindow.isMaximized()) {
      await currentWindow.unmaximize()
      setMaximized(false)
    } else {
      await currentWindow.maximize()
      setMaximized(true)
    }
  }, [setMaximized])

  useEffect(() => {
    getCurrentWindow().setMinimizable(true)
  }, [])

  const handleTitlebarMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      // Left button only, and only on the first press: detail 2 is the second
      // press of a double-click, which `handleTitlebarDoubleClick` turns into maximize.
      if (event.button !== 0 || event.detail !== 1) return
      // Only the empty bar area drags; the control buttons keep their own clicks.
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      void getCurrentWindow()
        .startDragging()
        .catch((error) => console.warn('[WindowControls] 开始拖动失败:', error))
    },
    [],
  )

  const handleTitlebarDoubleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      void toggleMaximize().catch((error) =>
        console.warn('[WindowControls] 切换最大化失败:', error),
      )
    },
    [toggleMaximize],
  )

  return (
    <Box
      onMouseDown={handleTitlebarMouseDown}
      onDoubleClick={handleTitlebarDoubleClick}
      sx={{
        display: 'flex',
        justifyContent: OS === 'macos' ? 'flex-start' : 'flex-end',
        width: '100%',
        height: '100%',
        px: 1,
        gap: 1,
        alignItems: 'center',
        '> button': {
          cursor: 'default',
        },
      }}
    >
      {OS === 'macos' && (
        <>
          {/* macOS 风格：关闭 → 最小化 → 全屏 */}
          <IconButton size="small" sx={{ fontSize: 14 }} onClick={close}>
            <Close fontSize="inherit" color="inherit" />
          </IconButton>
          <IconButton size="small" sx={{ fontSize: 14 }} onClick={minimize}>
            <Minimize fontSize="inherit" color="inherit" />
          </IconButton>
          <IconButton
            size="small"
            sx={{ fontSize: 14 }}
            onClick={toggleMaximize}
          >
            {maximized ? (
              <FilterNone fontSize="inherit" color="inherit" />
            ) : (
              <CropSquare fontSize="inherit" color="inherit" />
            )}
          </IconButton>
        </>
      )}

      {OS === 'windows' && (
        <>
          {/* Windows 风格：最小化 → 最大化 → 关闭 */}
          <IconButton size="small" sx={{ fontSize: 16 }} onClick={minimize}>
            <Minimize fontSize="inherit" color="inherit" />
          </IconButton>
          <IconButton
            size="small"
            sx={{ fontSize: 16 }}
            onClick={toggleMaximize}
          >
            {maximized ? (
              <FilterNone fontSize="inherit" color="inherit" />
            ) : (
              <CropSquare fontSize="inherit" color="inherit" />
            )}
          </IconButton>
          <IconButton
            size="small"
            sx={{ fontSize: 16, ':hover': { bgcolor: 'red', color: 'white' } }}
            onClick={close}
          >
            <Close fontSize="inherit" color="inherit" />
          </IconButton>
        </>
      )}

      {OS === 'linux' && (
        <>
          {/* Linux 桌面常见布局（GNOME/KDE 多为：最小化 → 最大化 → 关闭） */}
          <IconButton size="small" sx={{ fontSize: 16 }} onClick={minimize}>
            <Minimize fontSize="inherit" color="inherit" />
          </IconButton>
          <IconButton
            size="small"
            sx={{ fontSize: 16 }}
            onClick={toggleMaximize}
          >
            {maximized ? (
              <FilterNone fontSize="inherit" color="inherit" />
            ) : (
              <CropSquare fontSize="inherit" color="inherit" />
            )}
          </IconButton>
          <IconButton
            size="small"
            sx={{ fontSize: 16, ':hover': { bgcolor: 'red', color: 'white' } }}
            onClick={close}
          >
            <Close fontSize="inherit" color="inherit" />
          </IconButton>
        </>
      )}
    </Box>
  )
}
