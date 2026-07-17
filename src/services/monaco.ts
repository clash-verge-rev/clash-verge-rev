type MonacoModule = typeof import('monaco-editor')
type MonacoEditorPackage = typeof import('@monaco-editor/react')

type MonacoEditorBundle = {
  Editor: MonacoEditorPackage['default']
  beforeEditorMount: () => void
}

let loadPromise: Promise<MonacoEditorBundle> | undefined
let monacoConfigured = false

const patchCreateWebWorker = (monaco: MonacoModule) => {
  const createWebWorker = monaco.editor.createWebWorker

  type CreateWebWorker = typeof createWebWorker
  type WorkerOptions = Parameters<CreateWebWorker>[0] & { worker?: unknown }

  monaco.editor.createWebWorker = ((options: WorkerOptions) =>
    'worker' in options
      ? createWebWorker(options)
      : monaco.createWebWorker(options)) as CreateWebWorker
}

export const loadMonacoEditor = () => {
  loadPromise ??= Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
    import('monaco-editor/esm/vs/language/css/css.worker?worker'),
    import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    import('monaco-yaml'),
    import('meta-json-schema/schemas/meta-json-schema.json'),
    import('types-pac/pac.d.ts?raw'),
    import('@/utils/yaml.worker?worker'),
  ]).then(
    ([
      editorModule,
      monaco,
      { default: EditorWorker },
      { default: CssWorker },
      { default: TsWorker },
      { configureMonacoYaml },
      { default: metaSchema },
      { default: pac },
      { default: YamlWorker },
    ]) => {
      const workers = {
        css: CssWorker,
        less: CssWorker,
        scss: CssWorker,
        typescript: TsWorker,
        javascript: TsWorker,
        yaml: YamlWorker,
      }

      self.MonacoEnvironment = {
        getWorker(_, label) {
          return new (workers[label as keyof typeof workers] ?? EditorWorker)()
        },
      }

      editorModule.loader.config({ monaco })

      return {
        Editor: editorModule.default,
        beforeEditorMount: () => {
          if (monacoConfigured) return

          patchCreateWebWorker(monaco)
          monaco.typescript.javascriptDefaults.addExtraLib(pac, 'pac.d.ts')

          configureMonacoYaml(monaco, {
            validate: true,
            enableSchemaRequest: true,
            completion: true,
            schemas: [
              {
                uri: 'http://example.com/meta-json-schema.json',
                fileMatch: ['**/*.yaml', '**/*.yml'],
                schema:
                  metaSchema as unknown as import('monaco-yaml').JSONSchema,
              },
            ],
          })

          monacoConfigured = true
        },
      }
    },
  )

  return loadPromise
}
