import MonacoEditor from '@monaco-editor/react'
import {
  CloseFullscreenRounded,
  ContentPasteRounded,
  FormatPaintRounded,
  OpenInFullRounded,
} from '@mui/icons-material'
import {
  Button,
  ButtonGroup,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
} from '@mui/material'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useLockFn } from 'ahooks'
import type { editor } from 'monaco-editor'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseLoadingOverlay } from '@/components/base'
import { beforeEditorMount } from '@/services/monaco'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'
import debounce from '@/utils/debounce'
import getSystem from '@/utils/get-system'

const appWindow = getCurrentWebviewWindow()

export type EditorLanguage = 'yaml' | 'javascript' | 'css'

export interface EditorViewerProps {
  open: boolean
  title?: string | ReactNode
  value: string
  language: EditorLanguage
  path: string
  readOnly?: boolean
  loading?: boolean
  dirty?: boolean
  saveDisabled?: boolean
  onChange?: (value: string) => void
  onSave?: () => void | Promise<void>
  onClose: () => void
  onValidate?: (markers: editor.IMarker[]) => void
}

export const EditorViewer = ({
  open,
  title,
  value,
  language,
  path,
  readOnly = false,
  loading = false,
  dirty,
  saveDisabled = false,
  onChange,
  onSave,
  onClose,
  onValidate,
}: EditorViewerProps) => {
  const { t } = useTranslation()
  const themeMode = useThemeMode()
  const [isMaximized, setIsMaximized] = useState(false)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const resolvedTitle = title ?? t('profiles.components.menu.editFile')
  const disableSave = loading || saveDisabled || dirty === false

  const syncMaximizedState = useCallback(async () => {
    try {
      setIsMaximized(await appWindow.isMaximized())
    } catch {
      setIsMaximized(false)
    }
  }, [])

  const handleSave = useLockFn(async () => {
    try {
      if (!readOnly) {
        await onSave?.()
      }
      onClose()
    } catch (error) {
      showNotice.error(error)
    }
  })

  const handleClose = () => {
    try {
      onClose()
    } catch (error) {
      showNotice.error(error)
    }
  }

  const handlePaste = useLockFn(async () => {
    try {
      if (readOnly || loading || !editorRef.current) return

      const text = await navigator.clipboard.readText()
      if (!text) return

      const editorInstance = editorRef.current
      const model = editorInstance.getModel()
      const selections = editorInstance.getSelections()
      if (!model || !selections || selections.length === 0) return

      editorInstance.pushUndoStop()
      editorInstance.executeEdits(
        'explicit-paste',
        selections.map((selection) => ({
          range: selection,
          text,
          forceMoveMarkers: true,
        })),
      )
      editorInstance.pushUndoStop()
      editorInstance.focus()
    } catch (error) {
      showNotice.error(error)
    }
  })

  const handleFormat = useLockFn(async () => {
    try {
      if (loading) return
      await editorRef.current?.getAction('editor.action.formatDocument')?.run()
    } catch (error) {
      showNotice.error(error)
    }
  })

  const handleToggleMaximize = useLockFn(async () => {
    try {
      await appWindow.toggleMaximize()
      await syncMaximizedState()
      editorRef.current?.layout()
    } catch (error) {
      showNotice.error(error)
    }
  })

  useEffect(() => {
    if (!open) return
    void syncMaximizedState()
  }, [open, syncMaximizedState])

  useEffect(() => {
    if (!open) return

    const onResized = debounce(() => {
      void syncMaximizedState()
      try {
        editorRef.current?.layout()
      } catch {
        // Ignore transient layout errors during window transitions.
      }
    }, 100)

    const unlistenResized = appWindow.onResized(onResized)

    return () => {
      unlistenResized.then((unlisten) => unlisten())
    }
  }, [open, syncMaximizedState])

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xl"
      fullWidth
      disableEnforceFocus
    >
      <DialogTitle>{resolvedTitle}</DialogTitle>

      <DialogContent
        sx={{
          width: 'auto',
          height: 'calc(100vh - 185px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
          <BaseLoadingOverlay isLoading={loading} />
          {!loading && (
            <MonacoEditor
              height="100%"
              path={path}
              value={value}
              language={language}
              theme={themeMode === 'light' ? 'light' : 'vs-dark'}
              loading={null}
              saveViewState
              keepCurrentModel={false}
              beforeMount={beforeEditorMount}
              onMount={(editorInstance) => {
                editorRef.current = editorInstance
              }}
              onChange={(nextValue) => onChange?.(nextValue ?? '')}
              onValidate={onValidate}
              options={{
                automaticLayout: true,
                tabSize: 2,
                minimap: {
                  enabled:
                    typeof document !== 'undefined' &&
                    document.documentElement.clientWidth >= 1500,
                },
                mouseWheelZoom: true,
                readOnly,
                readOnlyMessage: {
                  value: t('profiles.modals.editor.messages.readOnly'),
                },
                renderValidationDecorations: 'on',
                quickSuggestions: {
                  strings: true,
                  comments: true,
                  other: true,
                },
                padding: {
                  top: 33,
                },
                fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
                  getSystem() === 'windows' ? ', twemoji mozilla' : ''
                }`,
                fontLigatures: false,
                smoothScrolling: true,
              }}
            />
          )}
        </div>

        <ButtonGroup
          variant="contained"
          sx={{ position: 'absolute', left: '14px', bottom: '8px' }}
        >
          <IconButton
            size="medium"
            color="inherit"
            sx={{ display: readOnly ? 'none' : '' }}
            title={t('profiles.page.importForm.actions.paste')}
            disabled={loading}
            onClick={() => {
              void handlePaste()
            }}
          >
            <ContentPasteRounded fontSize="inherit" />
          </IconButton>
          <IconButton
            size="medium"
            color="inherit"
            sx={{ display: readOnly ? 'none' : '' }}
            title={t('profiles.modals.editor.actions.format')}
            disabled={loading}
            onClick={() => {
              void handleFormat()
            }}
          >
            <FormatPaintRounded fontSize="inherit" />
          </IconButton>
          <IconButton
            size="medium"
            color="inherit"
            title={t(
              isMaximized ? 'shared.window.minimize' : 'shared.window.maximize',
            )}
            onClick={() => {
              void handleToggleMaximize()
            }}
          >
            {isMaximized ? <CloseFullscreenRounded /> : <OpenInFullRounded />}
          </IconButton>
        </ButtonGroup>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} variant="outlined">
          {t(readOnly ? 'shared.actions.close' : 'shared.actions.cancel')}
        </Button>
        {!readOnly && (
          <Button
            onClick={() => {
              void handleSave()
            }}
            variant="contained"
            disabled={disableSave}
          >
            {t('shared.actions.save')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
