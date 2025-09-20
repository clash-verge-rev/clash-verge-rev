import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  VerticalAlignTopRounded,
  VerticalAlignBottomRounded,
} from "@mui/icons-material";
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
} from "@mui/material";
import { useLockFn } from "ahooks";
import yaml from "js-yaml";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import MonacoEditor from "react-monaco-editor";
import { Virtuoso } from "react-virtuoso";

import { ProxyItem } from "@/components/profile/proxy-item";
import { readProfileFile, saveProfileFile } from "@/services/cmds";
import { showNotice } from "@/services/noticeService";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";
import parseUri from "@/utils/uri-parser";

import { BaseSearchBox } from "../base/base-search-box";

interface Props {
  profileUid: string;
  property: string;
  open: boolean;
  onClose: () => void;
  onSave?: (prev?: string, curr?: string) => void;
}

export const ProxiesEditorViewer = (props: Props) => {
  const { profileUid, property, open, onClose, onSave } = props;
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const [prevData, setPrevData] = useState("");
  const [currData, setCurrData] = useState("");
  const [visualization, setVisualization] = useState(true);
  const [match, setMatch] = useState(() => (_: string) => true);
  const [proxyUri, setProxyUri] = useState<string>("");

  const [proxyList, setProxyList] = useState<IProxyConfig[]>([]);
  const [prependSeq, setPrependSeq] = useState<IProxyConfig[]>([]);
  const [appendSeq, setAppendSeq] = useState<IProxyConfig[]>([]);
  const [deleteSeq, setDeleteSeq] = useState<string[]>([]);

  const filteredPrependSeq = useMemo(
    () => prependSeq.filter((proxy) => match(proxy.name)),
    [prependSeq, match],
  );
  const filteredProxyList = useMemo(
    () => proxyList.filter((proxy) => match(proxy.name)),
    [proxyList, match],
  );
  const filteredAppendSeq = useMemo(
    () => appendSeq.filter((proxy) => match(proxy.name)),
    [appendSeq, match],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const reorder = (
    list: IProxyConfig[],
    startIndex: number,
    endIndex: number,
  ) => {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };
  const onPrependDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        let activeIndex = 0;
        let overIndex = 0;
        prependSeq.forEach((item, index) => {
          if (item.name === active.id) {
            activeIndex = index;
          }
          if (item.name === over.id) {
            overIndex = index;
          }
        });

        setPrependSeq(reorder(prependSeq, activeIndex, overIndex));
      }
    }
  };
  const onAppendDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        let activeIndex = 0;
        let overIndex = 0;
        appendSeq.forEach((item, index) => {
          if (item.name === active.id) {
            activeIndex = index;
          }
          if (item.name === over.id) {
            overIndex = index;
          }
        });
        setAppendSeq(reorder(appendSeq, activeIndex, overIndex));
      }
    }
  };
  // 优化：异步分片解析，避免主线程阻塞，解析完成后批量setState
  const handleParseAsync = (cb: (proxies: IProxyConfig[]) => void) => {
    const proxies: IProxyConfig[] = [];
    const names: string[] = [];
    let uris = "";
    try {
      uris = atob(proxyUri);
    } catch {
      uris = proxyUri;
    }
    const lines = uris.trim().split("\n");
    let idx = 0;
    const batchSize = 50;
    function parseBatch() {
      const end = Math.min(idx + batchSize, lines.length);
      for (; idx < end; idx++) {
        const uri = lines[idx];
        try {
          const proxy = parseUri(uri.trim());
          if (!names.includes(proxy.name)) {
            proxies.push(proxy);
            names.push(proxy.name);
          }
        } catch (err: any) {
          console.warn(
            "[ProxiesEditorViewer] parseUri failed for line:",
            uri,
            err?.message || err,
          );
          // 不阻塞主流程
        }
      }
      if (idx < lines.length) {
        setTimeout(parseBatch, 0);
      } else {
        cb(proxies);
      }
    }
    parseBatch();
  };
  const fetchProfile = async () => {
    const data = await readProfileFile(profileUid);

    const originProxiesObj = yaml.load(data) as {
      proxies: IProxyConfig[];
    } | null;

    setProxyList(originProxiesObj?.proxies || []);
  };

  const fetchContent = async () => {
    const data = await readProfileFile(property);
    const obj = yaml.load(data) as ISeqProfileConfig | null;

    setPrependSeq(obj?.prepend || []);
    setAppendSeq(obj?.append || []);
    setDeleteSeq(obj?.delete || []);

    setPrevData(data);
    setCurrData(data);
  };

  useEffect(() => {
    if (currData === "") return;
    if (visualization !== true) return;

    const obj = yaml.load(currData) as {
      prepend: [];
      append: [];
      delete: [];
    } | null;
    setPrependSeq(obj?.prepend || []);
    setAppendSeq(obj?.append || []);
    setDeleteSeq(obj?.delete || []);
  }, [visualization]);

  useEffect(() => {
    if (prependSeq && appendSeq && deleteSeq) {
      const serialize = () => {
        try {
          setCurrData(
            yaml.dump(
              { prepend: prependSeq, append: appendSeq, delete: deleteSeq },
              { forceQuotes: true },
            ),
          );
        } catch (e) {
          console.warn("[ProxiesEditorViewer] yaml.dump failed:", e);
          // 防止异常导致UI卡死
        }
      };
      if (window.requestIdleCallback) {
        window.requestIdleCallback(serialize);
      } else {
        setTimeout(serialize, 0);
      }
    }
  }, [prependSeq, appendSeq, deleteSeq]);

  useEffect(() => {
    if (!open) return;
    fetchContent();
    fetchProfile();
  }, [open]);

  const handleSave = useLockFn(async () => {
    try {
      await saveProfileFile(property, currData);
      showNotice("success", t("Saved Successfully"));
      onSave?.(prevData, currData);
      onClose();
    } catch (err: any) {
      showNotice("error", err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        {
          <Box display="flex" justifyContent="space-between">
            {t("Edit Proxies")}
            <Box>
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  setVisualization((prev) => !prev);
                }}
              >
                {visualization ? t("Advanced") : t("Visualization")}
              </Button>
            </Box>
          </Box>
        }
      </DialogTitle>

      <DialogContent
        sx={{ display: "flex", width: "auto", height: "calc(100vh - 185px)" }}
      >
        {visualization ? (
          <>
            <List
              sx={{
                width: "50%",
                padding: "0 10px",
              }}
            >
              <Box
                sx={{
                  height: "calc(100% - 80px)",
                  overflowY: "auto",
                }}
              >
                <Item>
                  <TextField
                    autoComplete="new-password"
                    placeholder={t("Use newlines for multiple uri")}
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
                      setPrependSeq((prev) => [...proxies, ...prev]);
                    });
                  }}
                >
                  {t("Prepend Proxy")}
                </Button>
              </Item>
              <Item>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<VerticalAlignBottomRounded />}
                  onClick={() => {
                    handleParseAsync((proxies) => {
                      setAppendSeq((prev) => [...prev, ...proxies]);
                    });
                  }}
                >
                  {t("Append Proxy")}
                </Button>
              </Item>
            </List>

            <List
              sx={{
                width: "50%",
                padding: "0 10px",
              }}
            >
              <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
              <Virtuoso
                style={{ height: "calc(100% - 24px)", marginTop: "8px" }}
                totalCount={
                  filteredProxyList.length +
                  (filteredPrependSeq.length > 0 ? 1 : 0) +
                  (filteredAppendSeq.length > 0 ? 1 : 0)
                }
                increaseViewportBy={256}
                itemContent={(index) => {
                  const shift = filteredPrependSeq.length > 0 ? 1 : 0;
                  if (filteredPrependSeq.length > 0 && index === 0) {
                    return (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onPrependDragEnd}
                      >
                        <SortableContext
                          items={filteredPrependSeq.map((x) => {
                            return x.name;
                          })}
                        >
                          {filteredPrependSeq.map((item, index) => {
                            return (
                              <ProxyItem
                                key={`${item.name}-${index}`}
                                type="prepend"
                                proxy={item}
                                onDelete={() => {
                                  setPrependSeq(
                                    prependSeq.filter(
                                      (v) => v.name !== item.name,
                                    ),
                                  );
                                }}
                              />
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    );
                  } else if (index < filteredProxyList.length + shift) {
                    const newIndex = index - shift;
                    return (
                      <ProxyItem
                        key={`${filteredProxyList[newIndex].name}-${index}`}
                        type={
                          deleteSeq.includes(filteredProxyList[newIndex].name)
                            ? "delete"
                            : "original"
                        }
                        proxy={filteredProxyList[newIndex]}
                        onDelete={() => {
                          if (
                            deleteSeq.includes(filteredProxyList[newIndex].name)
                          ) {
                            setDeleteSeq(
                              deleteSeq.filter(
                                (v) => v !== filteredProxyList[newIndex].name,
                              ),
                            );
                          } else {
                            setDeleteSeq((prev) => [
                              ...prev,
                              filteredProxyList[newIndex].name,
                            ]);
                          }
                        }}
                      />
                    );
                  } else {
                    return (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onAppendDragEnd}
                      >
                        <SortableContext
                          items={filteredAppendSeq.map((x) => {
                            return x.name;
                          })}
                        >
                          {filteredAppendSeq.map((item, index) => {
                            return (
                              <ProxyItem
                                key={`${item.name}-${index}`}
                                type="append"
                                proxy={item}
                                onDelete={() => {
                                  setAppendSeq(
                                    appendSeq.filter(
                                      (v) => v.name !== item.name,
                                    ),
                                  );
                                }}
                              />
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    );
                  }
                }}
              />
            </List>
          </>
        ) : (
          <MonacoEditor
            height="100%"
            language="yaml"
            value={currData}
            theme={themeMode === "light" ? "vs" : "vs-dark"}
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
              fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
                getSystem() === "windows" ? ", twemoji mozilla" : ""
              }`,
              fontLigatures: false, // 连字符
              smoothScrolling: true, // 平滑滚动
            }}
            onChange={(value) => setCurrData(value)}
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t("Cancel")}
        </Button>

        <Button onClick={handleSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
}));
