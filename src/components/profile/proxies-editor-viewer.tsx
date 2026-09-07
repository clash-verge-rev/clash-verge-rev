import { arrayMove } from '@dnd-kit/helpers'
import {
  DragDropProvider,
  type DragOverEvent,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
} from '@dnd-kit/react'
import { isSortable, isSortableOperation } from '@dnd-kit/react/sortable'
import {
  VerticalAlignBottomRounded,
  VerticalAlignTopRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  TextField,
  styled,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import * as yaml from 'js-yaml'
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  BaseSearchBox,
  MonacoEditor,
  SortableItem,
  VirtualList,
} from '@/components/base'
import { ProxyItem } from '@/components/profile/proxy-item'
import { readProfileFile, saveProfileFile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { useThemeMode } from '@/services/states'
import type { MonacoEditorInstance } from '@/types/monaco'
import { MONACO_FONT_FAMILY } from '@/utils/font-family'
import parseUri from '@/utils/uri-parser'
import { parseYamlSafe } from '@/utils/yaml'

interface Props {
  profileUid: string
  property: string
  open: boolean
  onClose: () => void
  onSave?: (prev?: string, curr?: string) => void
}

const findRealIndex = (
  list: IProxyConfig[],
  filtered: IProxyConfig[],
  filteredIndex: number,
): number => {
  const item = filtered[filteredIndex]
  if (!item) return -1
  return list.findIndex((proxy) => proxy.name === item.name)
}

// 节点的 name 会被用作 sortable item id、React key 以及拖拽排序的
// 依据。当 name 为空/null（例如高级模式下粘贴了缺少 name 的节点）时，
// 无效 name 不能作为 sortable item id，否则会导致拖拽注册失败。
// 这里统一过滤掉没有有效 name 的节点，避免可视化编辑页崩溃；原始 YAML
// 数据仍然保留，用户可在高级(文本)模式中查看并修正这些节点。
const hasValidName = (proxy: IProxyConfig) =>
  typeof proxy?.name === 'string' && proxy.name.length > 0

export const ProxiesEditorViewer = (props: Props) => {
  const { profileUid, property, open, onClose, onSave } = props
  const { t } = useTranslation()
  const themeMode = useThemeMode()
  const editorRef = useRef<MonacoEditorInstance | null>(null)
  const [prevData, setPrevData] = useState('')
  const [currData, setCurrData] = useState('')
  const [visualization, setVisualization] = useState(true)
  const [match, setMatch] = useState(() => (_: string) => true)
  const [proxyUri, setProxyUri] = useState<string>('')

  const [proxyList, setProxyList] = useState<IProxyConfig[]>([])
  const [prependSeq, setPrependSeq] = useState<IProxyConfig[]>([])
  const [appendSeq, setAppendSeq] = useState<IProxyConfig[]>([])
  const [deleteSeq, setDeleteSeq] = useState<string[]>([])
  const hasLoadedSeqConfigRef = useRef(false)

  const filteredPrependSeq = useMemo(
    () =>
      prependSeq.filter((proxy) => hasValidName(proxy) && match(proxy.name)),
    [prependSeq, match],
  )
  const filteredProxyList = useMemo(
    () => proxyList.filter((proxy) => hasValidName(proxy) && match(proxy.name)),
    [proxyList, match],
  )
  const filteredAppendSeq = useMemo(
    () => appendSeq.filter((proxy) => hasValidName(proxy) && match(proxy.name)),
    [appendSeq, match],
  )

  const renderItem = (index: number): React.ReactNode => {
    const shift = filteredPrependSeq.length > 0 ? 1 : 0
    if (filteredPrependSeq.length > 0 && index === 0) {
      return (
        <>
          {filteredPrependSeq.map((item, itemIndex) => {
            return (
              <SortableItem
                key={item.name}
                id={`prepend:${item.name}`}
                index={itemIndex}
                group="prepend"
                style={{ margin: '8px 0' }}
              >
                <ProxyItem
                  type="prepend"
                  proxy={item}
                  onDelete={() => {
                    setPrependSeq(
                      prependSeq.filter((v) => v.name !== item.name),
                    )
                  }}
                />
              </SortableItem>
            )
          })}
        </>
      )
    } else if (index < filteredProxyList.length + shift) {
      const newIndex = index - shift
      return (
        <Box sx={{ margin: '8px 0' }}>
          <ProxyItem
            key={filteredProxyList[newIndex].name}
            type={
              deleteSeq.includes(filteredProxyList[newIndex].name)
                ? 'delete'
                : 'original'
            }
            proxy={filteredProxyList[newIndex]}
            onDelete={() => {
              if (deleteSeq.includes(filteredProxyList[newIndex].name)) {
                setDeleteSeq(
                  deleteSeq.filter(
                    (v) => v !== filteredProxyList[newIndex].name,
                  ),
                )
              } else {
                setDeleteSeq((prev) => [
                  ...prev,
                  filteredProxyList[newIndex].name,
                ])
              }
            }}
          />
        </Box>
      )
    } else {
      return (
        <>
          {filteredAppendSeq.map((item, itemIndex) => {
            return (
              <SortableItem
                key={item.name}
                id={`append:${item.name}`}
                index={itemIndex}
                group="append"
                style={{ margin: '8px 0' }}
              >
                <ProxyItem
                  type="append"
                  proxy={item}
                  onDelete={() => {
                    setAppendSeq(appendSeq.filter((v) => v.name !== item.name))
                  }}
                />
              </SortableItem>
            )
          })}
        </>
      )
    }
  }

  const onPrependDragEnd = async (event: DragEndEvent) => {
    const { operation, canceled } = event
    const { source, target } = operation
    if (canceled || !target || !isSortable(source)) return

    const { index: overIndex, initialIndex: activeIndex } = source.sortable
    const activeRealIndex = findRealIndex(
      prependSeq,
      filteredPrependSeq,
      activeIndex,
    )
    const overRealIndex = findRealIndex(
      prependSeq,
      filteredPrependSeq,
      overIndex,
    )
    if (
      activeRealIndex < 0 ||
      overRealIndex < 0 ||
      activeRealIndex === overRealIndex
    ) {
      return
    }

    setPrependSeq(arrayMove(prependSeq, activeRealIndex, overRealIndex))
  }
  const onAppendDragEnd = async (event: DragEndEvent) => {
    const { operation, canceled } = event
    const { source, target } = operation
    if (canceled || !target || !isSortable(source)) return

    const { index: overIndex, initialIndex: activeIndex } = source.sortable
    const activeRealIndex = findRealIndex(
      appendSeq,
      filteredAppendSeq,
      activeIndex,
    )
    const overRealIndex = findRealIndex(appendSeq, filteredAppendSeq, overIndex)
    if (
      activeRealIndex < 0 ||
      overRealIndex < 0 ||
      activeRealIndex === overRealIndex
    ) {
      return
    }

    setAppendSeq(arrayMove(appendSeq, activeRealIndex, overRealIndex))
  }
  const onDragOver = (event: DragOverEvent) => {
    const { operation } = event
    if (!isSortableOperation(operation)) return

    const { source, target } = operation
    if (source?.group !== target?.group) {
      event.preventDefault()
    }
  }
  const onDragEnd = async (event: DragEndEvent) => {
    const source = event.operation.source
    if (!isSortable(source)) return

    const { initialGroup, group } = source.sortable
    if (initialGroup !== group) return

    if (group === 'prepend') {
      await onPrependDragEnd(event)
    } else if (group === 'append') {
      await onAppendDragEnd(event)
    }
  }
  // 优化：异步分片解析，避免主线程阻塞，解析完成后批量setState
  const handleParseAsync = (cb: (proxies: IProxyConfig[]) => void) => {
    const proxies: IProxyConfig[] = []
    const names: string[] = []
    let uris: string
    try {
      uris = atob(proxyUri)
    } catch {
      uris = proxyUri
    }
    const lines = uris.trim().split('\n')
    let idx = 0
    const batchSize = 50
    let parseTimer: number | undefined

    const parseBatch = () => {
      const end = Math.min(idx + batchSize, lines.length)
      for (; idx < end; idx++) {
        const uri = lines[idx]
        try {
          const proxy = parseUri(uri.trim())
          if (!names.includes(proxy.name)) {
            proxies.push(proxy)
            names.push(proxy.name)
          }
        } catch (err) {
          console.warn(
            '[ProxiesEditorViewer] parseUri failed for line:',
            uri,
            err,
          )
          // 不阻塞主流程
        }
      }
      if (idx < lines.length) {
        parseTimer = window.setTimeout(parseBatch, 0)
      } else {
        if (parseTimer !== undefined) {
          clearTimeout(parseTimer)
          parseTimer = undefined
        }
        cb(proxies)
      }
    }
    parseBatch()
  }
  const fetchProfile = useCallback(async () => {
    const data = await readProfileFile(profileUid)

    const originProxiesObj = parseYamlSafe(data) as {
      proxies: IProxyConfig[]
    } | null

    setProxyList(originProxiesObj?.proxies || [])
  }, [profileUid])

  const fetchContent = useCallback(async () => {
    hasLoadedSeqConfigRef.current = false
    const data = await readProfileFile(property)
    const obj = parseYamlSafe(data) as ISeqProfileConfig | null | undefined

    setPrevData(data)
    setCurrData(data)

    if (obj === undefined) {
      setVisualization(false)
      return
    }

    setPrependSeq(obj?.prepend || [])
    setAppendSeq(obj?.append || [])
    setDeleteSeq(obj?.delete || [])
    hasLoadedSeqConfigRef.current = true
  }, [property])

  const handleVisualizationToggle = () => {
    if (visualization) {
      setVisualization(false)
      return
    }

    const obj = parseYamlSafe(currData) as ISeqProfileConfig | null | undefined
    if (obj === undefined) {
      hasLoadedSeqConfigRef.current = false
      return
    }

    hasLoadedSeqConfigRef.current = true
    startTransition(() => {
      setPrependSeq(obj?.prepend ?? [])
      setAppendSeq(obj?.append ?? [])
      setDeleteSeq(obj?.delete ?? [])
    })
    setVisualization(true)
  }

  useEffect(() => {
    if (
      !hasLoadedSeqConfigRef.current ||
      !(prependSeq && appendSeq && deleteSeq)
    ) {
      return
    }

    const serialize = () => {
      if (!hasLoadedSeqConfigRef.current) {
        return
      }

      try {
        setCurrData(
          yaml.dump(
            { prepend: prependSeq, append: appendSeq, delete: deleteSeq },
            { forceQuotes: true },
          ),
        )
      } catch (e) {
        console.warn('[ProxiesEditorViewer] yaml.dump failed:', e)
        // 防止异常导致UI卡死
      }
    }
    let idleId: number | undefined
    let timeoutId: number | undefined
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(serialize)
    } else {
      timeoutId = window.setTimeout(serialize, 0)
    }
    return () => {
      if (idleId !== undefined && window.cancelIdleCallback) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
    }
  }, [prependSeq, appendSeq, deleteSeq])

  useEffect(() => {
    if (!open) return
    fetchContent()
    fetchProfile()
  }, [fetchContent, fetchProfile, open])

  useEffect(() => {
    return () => {
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [])

  const handleSave = useLockFn(async () => {
    try {
      if (!(await saveProfileFile(property, currData))) {
        await fetchContent()
        onClose()
        return
      }
      showNotice.success('shared.feedback.notifications.saved')
      onSave?.(prevData, currData)
      onClose()
    } catch (err) {
      showNotice.error(err)
    }
  })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      disableEnforceFocus={!visualization}
    >
      <DialogTitle>
        {
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            {t('profiles.modals.proxiesEditor.title')}
            <Box>
              <Button
                variant="contained"
                size="small"
                onClick={handleVisualizationToggle}
              >
                {visualization
                  ? t('shared.editorModes.advanced')
                  : t('shared.editorModes.visualization')}
              </Button>
            </Box>
          </Box>
        }
      </DialogTitle>

      <DialogContent
        sx={{ display: 'flex', width: 'auto', height: 'calc(100vh - 185px)' }}
      >
        {visualization ? (
          <>
            <List
              sx={{
                width: '50%',
                padding: '0 10px',
              }}
            >
              <Box
                sx={{
                  height: 'calc(100% - 80px)',
                  overflowY: 'auto',
                }}
              >
                <Item>
                  <TextField
                    autoComplete="new-password"
                    placeholder={t(
                      'profiles.modals.proxiesEditor.placeholders.multiUri',
                    )}
                    fullWidth
                    rows={9}
                    multiline
                    size="small"
                    onChange={(e) => setProxyUri(e.target.value)}
                  />
                </Item>
              </Box>
              <Item>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<VerticalAlignTopRounded />}
                  onClick={() => {
                    handleParseAsync((proxies) => {
                      setPrependSeq((prev) => [...proxies, ...prev])
                    })
                  }}
                >
                  {t('profiles.modals.proxiesEditor.actions.prepend')}
                </Button>
              </Item>
              <Item>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<VerticalAlignBottomRounded />}
                  onClick={() => {
                    handleParseAsync((proxies) => {
                      setAppendSeq((prev) => [...prev, ...proxies])
                    })
                  }}
                >
                  {t('profiles.modals.proxiesEditor.actions.append')}
                </Button>
              </Item>
            </List>

            <List
              sx={{
                width: '50%',
                padding: '0 10px',
              }}
            >
              <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
              <DragDropProvider
                sensors={[PointerSensor, KeyboardSensor]}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
              >
                <VirtualList
                  count={
                    filteredProxyList.length +
                    (filteredPrependSeq.length > 0 ? 1 : 0) +
                    (filteredAppendSeq.length > 0 ? 1 : 0)
                  }
                  estimateSize={56}
                  renderItem={renderItem}
                  style={{ height: 'calc(100% - 24px)', marginTop: '8px' }}
                />
              </DragDropProvider>
            </List>
          </>
        ) : (
          <MonacoEditor
            height="100%"
            language="yaml"
            value={currData}
            theme={themeMode === 'light' ? 'light' : 'vs-dark'}
            onMount={(editorInstance) => {
              editorRef.current = editorInstance
            }}
            options={{
              tabSize: 2, // 根据语言类型设置缩进大小
              minimap: {
                enabled: document.documentElement.clientWidth >= 1500, // 超过一定宽度显示minimap滚动条
              },
              mouseWheelZoom: true, // 按住Ctrl滚轮调节缩放比例
              quickSuggestions: {
                strings: true, // 字符串类型的建议
                comments: true, // 注释类型的建议
                other: true, // 其他类型的建议
              },
              padding: {
                top: 33, // 顶部padding防止遮挡snippets
              },
              fontFamily: MONACO_FONT_FAMILY,
              fontLigatures: false, // 连字符
              smoothScrolling: true, // 平滑滚动
            }}
            onChange={(value) => setCurrData(value ?? '')}
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t('shared.actions.cancel')}
        </Button>

        <Button onClick={handleSave} variant="contained">
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const Item = styled(ListItem)(() => ({
  padding: '5px 2px',
}))
