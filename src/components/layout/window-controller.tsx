import { Close, CropSquare, FilterNone, Minimize } from '@mui/icons-material'
import { Box, IconButton } from '@mui/material'
import { forwardRef, useImperativeHandle } from 'react'

import { useWindowControls } from '@/hooks/use-window'
import getSystem from '@/utils/get-system'

export const WindowControls = forwardRef(function WindowControls(props, ref) {
  const OS = getSystem()
  const {
    currentWindow,
    maximized,
    minimize,
    close,
    toggleFullscreen,
    toggleMaximize,
  } = useWindowControls()

  useImperativeHandle(
    ref,
    () => ({
      currentWindow,
      maximized,
      minimize,
      close,
      toggleFullscreen,
      toggleMaximize,
    }),
    [
      currentWindow,
      maximized,
      minimize,
      close,
      toggleFullscreen,
      toggleMaximize,
    ],
  )

  // 通过前端对 tauri 窗口进行翻转全屏时会短暂地与系统图标重叠渲染。
  // 这可能是上游缺陷，保险起见跨平台以窗口的最大化翻转为准。

  return (
    <Box
      // 必须显式排除拖拽区域，否则 Linux/WebKitGTK 下 Tauri 的拖拽事件
      // 会渗透到按钮区域，拦截点击事件导致关闭/最小化/最大化按钮无法响应
      data-tauri-drag-region="false"
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        '> button': {
          cursor: 'pointer',
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
})
