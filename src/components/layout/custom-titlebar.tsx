import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Box, IconButton, useTheme } from '@mui/material';
import MinimizeIcon from '@mui/icons-material/Minimize';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import FilterNoneIcon from '@mui/icons-material/FilterNone'; // Icon for restore
import CloseIcon from '@mui/icons-material/Close';
import { useEffect, useState } from 'react';
import { type UnlistenFn } from '@tauri-apps/api/event';

export function Titlebar() {
  const appWindow = getCurrentWebviewWindow();
  const theme = useTheme();
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  useEffect(() => {
    let unlisten: UnlistenFn;

    const updateState = async () => {
      setIsMaximized(await appWindow.isMaximized());
    };

    appWindow.onResized(() => {
      updateState();
    }).then((fn) => {
      unlisten = fn;
    });

    updateState();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [appWindow]);

  const iconSize = { fontSize: '18px' };

  const iconButtonStyle = {
    height: '100%',
    width: '40px',
    borderRadius: 0,
    '&:hover': {
      backgroundColor:
        theme.palette.mode === 'dark'
          ? 'rgba(255, 255, 255, 0.1)'
          : 'rgba(0, 0, 0, 0.1)',
    },
  };

  return (
    <Box
      data-tauri-drag-region
      sx={{
        height: '32px',
        display: 'flex',
        justifyContent: 'flex-end',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1200,
        backgroundColor: 'transparent',
      }}
    >
      <IconButton
        onClick={handleMinimize}
        size="small"
        sx={iconButtonStyle}
        disableRipple
      >
        <MinimizeIcon sx={iconSize} />
      </IconButton>
      <IconButton
        onClick={handleMaximize}
        size="small"
        sx={iconButtonStyle}
        disableRipple
      >
        {isMaximized ? <FilterNoneIcon sx={iconSize} /> : <CropSquareIcon sx={iconSize} />}
      </IconButton>
      <IconButton
        onClick={handleClose}
        size="small"
        sx={{
          ...iconButtonStyle,
          '&:hover': {
            backgroundColor: 'red',
          },
        }}
        disableRipple
      >
        <CloseIcon sx={iconSize} />
      </IconButton>
    </Box>
  );
}
