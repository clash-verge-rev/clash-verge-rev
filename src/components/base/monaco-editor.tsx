import { Suspense, lazy } from 'react'

import { loadMonacoEditor } from '@/services/monaco'

type MonacoEditorProps = import('@monaco-editor/react').EditorProps

let monacoEditorBundle: Awaited<ReturnType<typeof loadMonacoEditor>>

const MonacoEditorView = ({ beforeMount, ...props }: MonacoEditorProps) => {
  const { Editor, beforeEditorMount } = monacoEditorBundle

  return (
    <Editor
      {...props}
      beforeMount={(monaco) => {
        beforeEditorMount()
        beforeMount?.(monaco)
      }}
    />
  )
}

const MonacoEditorContent = lazy(async () => {
  monacoEditorBundle = await loadMonacoEditor()
  return { default: MonacoEditorView }
})

export const MonacoEditor = (props: MonacoEditorProps) => (
  <Suspense fallback={null}>
    <MonacoEditorContent {...props} />
  </Suspense>
)
