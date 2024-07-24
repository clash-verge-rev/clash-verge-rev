import { useEffect, useMemo, useState } from "react";
import { useLockFn } from "ahooks";
import yaml from "js-yaml";
import { useTranslation } from "react-i18next";
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
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  TextField,
  styled,
} from "@mui/material";
import {
  VerticalAlignTopRounded,
  VerticalAlignBottomRounded,
} from "@mui/icons-material";
import { GroupItem } from "@/components/profile/group-item";
import {
  getNetworkInterfaces,
  readProfileFile,
  saveProfileFile,
} from "@/services/cmds";
import { Notice, Switch } from "@/components/base";
import getSystem from "@/utils/get-system";
import { BaseSearchBox } from "../base/base-search-box";
import { Virtuoso } from "react-virtuoso";
import MonacoEditor from "react-monaco-editor";
import { useThemeMode } from "@/services/states";
import { Controller, useForm } from "react-hook-form";

interface Props {
  proxiesUid: string;
  mergeUid: string;
  profileUid: string;
  property: string;
  open: boolean;
  onClose: () => void;
  onSave?: (prev?: string, curr?: string) => void;
}

const builtinProxyPolicies = ["DIRECT", "REJECT", "REJECT-DROP", "PASS"];

export const GroupsEditorViewer = (props: Props) => {
  const { mergeUid, proxiesUid, profileUid, property, open, onClose, onSave } =
    props;
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const [prevData, setPrevData] = useState("");
  const [currData, setCurrData] = useState("");
  const [visualization, setVisualization] = useState(true);
  const [match, setMatch] = useState(() => (_: string) => true);
  const [interfaceNameList, setInterfaceNameList] = useState<string[]>([]);
  const { control, watch, register, ...formIns } = useForm<IProxyGroupConfig>({
    defaultValues: {
      type: "select",
      name: "",
      interval: 300,
      timeout: 5000,
      "max-failed-times": 5,
      lazy: true,
    },
  });
  const [groupList, setGroupList] = useState<IProxyGroupConfig[]>([]);
  const [proxyPolicyList, setProxyPolicyList] = useState<string[]>([]);
  const [proxyProviderList, setProxyProviderList] = useState<string[]>([]);
  const [prependSeq, setPrependSeq] = useState<IProxyGroupConfig[]>([]);
  const [appendSeq, setAppendSeq] = useState<IProxyGroupConfig[]>([]);
  const [deleteSeq, setDeleteSeq] = useState<string[]>([]);

  const filteredPrependSeq = useMemo(
    () => prependSeq.filter((group) => match(group.name)),
    [prependSeq, match]
  );
  const filteredGroupList = useMemo(
    () => groupList.filter((group) => match(group.name)),
    [groupList, match]
  );
  const filteredAppendSeq = useMemo(
    () => appendSeq.filter((group) => match(group.name)),
    [appendSeq, match]
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const reorder = (
    list: IProxyGroupConfig[],
    startIndex: number,
    endIndex: number
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
  const fetchContent = async () => {
    let data = await readProfileFile(property);
    let obj = yaml.load(data) as ISeqProfileConfig | null;

    setPrependSeq(obj?.prepend || []);
    setAppendSeq(obj?.append || []);
    setDeleteSeq(obj?.delete || []);

    setPrevData(data);
    setCurrData(data);
  };

  useEffect(() => {
    if (currData === "") return;
    if (visualization !== true) return;

    let obj = yaml.load(currData) as {
      prepend: [];
      append: [];
      delete: [];
    } | null;
    setPrependSeq(obj?.prepend || []);
    setAppendSeq(obj?.append || []);
    setDeleteSeq(obj?.delete || []);
  }, [visualization]);

  useEffect(() => {
    if (prependSeq && appendSeq && deleteSeq)
      setCurrData(
        yaml.dump(
          { prepend: prependSeq, append: appendSeq, delete: deleteSeq },
          {
            forceQuotes: true,
          }
        )
      );
  }, [prependSeq, appendSeq, deleteSeq]);

  const fetchProxyPolicy = async () => {
    let data = await readProfileFile(profileUid);
    let proxiesData = await readProfileFile(proxiesUid);
    let originGroupsObj = yaml.load(data) as {
      "proxy-groups": IProxyGroupConfig[];
    } | null;

    let originProxiesObj = yaml.load(data) as { proxies: [] } | null;
    let originProxies = originProxiesObj?.proxies || [];
    let moreProxiesObj = yaml.load(proxiesData) as ISeqProfileConfig | null;
    let morePrependProxies = moreProxiesObj?.prepend || [];
    let moreAppendProxies = moreProxiesObj?.append || [];
    let moreDeleteProxies =
      moreProxiesObj?.delete || ([] as string[] | { name: string }[]);

    let proxies = morePrependProxies.concat(
      originProxies.filter((proxy: any) => {
        if (proxy.name) {
          return !moreDeleteProxies.includes(proxy.name);
        } else {
          return !moreDeleteProxies.includes(proxy);
        }
      }),
      moreAppendProxies
    );

    setProxyPolicyList(
      builtinProxyPolicies.concat(
        prependSeq.map((group: IProxyGroupConfig) => group.name),
        originGroupsObj?.["proxy-groups"]
          .map((group: IProxyGroupConfig) => group.name)
          .filter((name) => !deleteSeq.includes(name)) || [],
        appendSeq.map((group: IProxyGroupConfig) => group.name),
        proxies.map((proxy: any) => proxy.name)
      )
    );
  };
  const fetchProfile = async () => {
    let data = await readProfileFile(profileUid);
    let mergeData = await readProfileFile(mergeUid);
    let globalMergeData = await readProfileFile("Merge");

    let originGroupsObj = yaml.load(data) as {
      "proxy-groups": IProxyGroupConfig[];
    } | null;

    let originProviderObj = yaml.load(data) as { "proxy-providers": {} } | null;
    let originProvider = originProviderObj?.["proxy-providers"] || {};

    let moreProviderObj = yaml.load(mergeData) as {
      "proxy-providers": {};
    } | null;
    let moreProvider = moreProviderObj?.["proxy-providers"] || {};

    let globalProviderObj = yaml.load(globalMergeData) as {
      "proxy-providers": {};
    } | null;
    let globalProvider = globalProviderObj?.["proxy-providers"] || {};

    let provider = Object.assign(
      {},
      originProvider,
      moreProvider,
      globalProvider
    );

    setProxyProviderList(Object.keys(provider));
    setGroupList(originGroupsObj?.["proxy-groups"] || []);
  };
  const getInterfaceNameList = async () => {
    let list = await getNetworkInterfaces();
    setInterfaceNameList(list);
  };
  useEffect(() => {
    fetchProxyPolicy();
  }, [prependSeq, appendSeq, deleteSeq]);
  useEffect(() => {
    if (!open) return;
    fetchContent();
    fetchProxyPolicy();
    fetchProfile();
    getInterfaceNameList();
  }, [open]);

  const validateGroup = () => {
    let group = formIns.getValues();
    if (group.name === "") {
      throw new Error(t("Group Name Required"));
    }
  };

  const handleSave = useLockFn(async () => {
    try {
      await saveProfileFile(property, currData);
      onSave?.(prevData, currData);
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        {
          <Box display="flex" justifyContent="space-between">
            {t("Edit Groups")}
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
                <Controller
                  name="type"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Group Type")} />
                      <Autocomplete
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        options={[
                          "select",
                          "url-test",
                          "fallback",
                          "load-balance",
                          "relay",
                        ]}
                        value={field.value}
                        renderOption={(props, option) => (
                          <li {...props} title={t(option)}>
                            {option}
                          </li>
                        )}
                        onChange={(_, value) => value && field.onChange(value)}
                        renderInput={(params) => <TextField {...params} />}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Group Name")} />
                      <TextField
                        autoComplete="new-password"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        {...field}
                        error={field.value === ""}
                        required={true}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="icon"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Proxy Group Icon")} />
                      <TextField
                        autoComplete="new-password"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        {...field}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="proxies"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Use Proxies")} />
                      <Autocomplete
                        size="small"
                        sx={{
                          width: "calc(100% - 150px)",
                        }}
                        multiple
                        options={proxyPolicyList}
                        disableCloseOnSelect
                        onChange={(_, value) => value && field.onChange(value)}
                        renderInput={(params) => <TextField {...params} />}
                        renderOption={(props, option) => (
                          <li {...props} title={t(option)}>
                            {option}
                          </li>
                        )}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="use"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Use Provider")} />
                      <Autocomplete
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        multiple
                        options={proxyProviderList}
                        disableCloseOnSelect
                        onChange={(_, value) => value && field.onChange(value)}
                        renderInput={(params) => <TextField {...params} />}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="url"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Health Check Url")} />
                      <TextField
                        autoComplete="new-password"
                        placeholder="https://www.gstatic.com/generate_204"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        {...field}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="expected-status"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Expected Status")} />
                      <TextField
                        autoComplete="new-password"
                        placeholder="*"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                        }}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="interval"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Interval")} />
                      <TextField
                        autoComplete="new-password"
                        placeholder="300"
                        type="number"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                        }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              {t("seconds")}
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="timeout"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Timeout")} />
                      <TextField
                        autoComplete="new-password"
                        placeholder="5000"
                        type="number"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                        }}
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              {t("millis")}
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="max-failed-times"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Max Failed Times")} />
                      <TextField
                        autoComplete="new-password"
                        placeholder="5"
                        type="number"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                        }}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="interface-name"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Interface Name")} />
                      <Autocomplete
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        options={interfaceNameList}
                        value={field.value}
                        onChange={(_, value) => value && field.onChange(value)}
                        renderInput={(params) => <TextField {...params} />}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="routing-mark"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Routing Mark")} />
                      <TextField
                        autoComplete="new-password"
                        type="number"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                        }}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="filter"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Filter")} />
                      <TextField
                        autoComplete="new-password"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        {...field}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="exclude-filter"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Exclude Filter")} />
                      <TextField
                        autoComplete="new-password"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        {...field}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="exclude-type"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Exclude Type")} />
                      <Autocomplete
                        multiple
                        options={[
                          "Direct",
                          "Reject",
                          "RejectDrop",
                          "Compatible",
                          "Pass",
                          "Dns",
                          "Shadowsocks",
                          "ShadowsocksR",
                          "Snell",
                          "Socks5",
                          "Http",
                          "Vmess",
                          "Vless",
                          "Trojan",
                          "Hysteria",
                          "Hysteria2",
                          "WireGuard",
                          "Tuic",
                          "Relay",
                          "Selector",
                          "Fallback",
                          "URLTest",
                          "LoadBalance",
                          "Ssh",
                        ]}
                        size="small"
                        disableCloseOnSelect
                        sx={{ width: "calc(100% - 150px)" }}
                        value={field.value?.split("|")}
                        onChange={(_, value) => {
                          field.onChange(value.join("|"));
                        }}
                        renderInput={(params) => <TextField {...params} />}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="include-all"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Include All")} />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="include-all-proxies"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Include All Proxies")} />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="include-all-providers"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Include All Providers")} />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="lazy"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Lazy")} />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="disable-udp"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Disable UDP")} />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="hidden"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText primary={t("Hidden")} />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
              </Box>
              <Item>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<VerticalAlignTopRounded />}
                  onClick={() => {
                    try {
                      validateGroup();
                      for (const item of [...prependSeq, ...groupList]) {
                        if (item.name === formIns.getValues().name) {
                          throw new Error(t("Group Name Already Exists"));
                        }
                      }
                      setPrependSeq([formIns.getValues(), ...prependSeq]);
                    } catch (err: any) {
                      Notice.error(err.message || err.toString());
                    }
                  }}
                >
                  {t("Prepend Group")}
                </Button>
              </Item>
              <Item>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<VerticalAlignBottomRounded />}
                  onClick={() => {
                    try {
                      validateGroup();
                      for (const item of [...appendSeq, ...groupList]) {
                        if (item.name === formIns.getValues().name) {
                          throw new Error(t("Group Name Already Exists"));
                        }
                      }
                      setAppendSeq([...appendSeq, formIns.getValues()]);
                    } catch (err: any) {
                      Notice.error(err.message || err.toString());
                    }
                  }}
                >
                  {t("Append Group")}
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
                  filteredGroupList.length +
                  (filteredPrependSeq.length > 0 ? 1 : 0) +
                  (filteredAppendSeq.length > 0 ? 1 : 0)
                }
                increaseViewportBy={256}
                itemContent={(index) => {
                  let shift = filteredPrependSeq.length > 0 ? 1 : 0;
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
                              <GroupItem
                                key={`${item.name}-${index}`}
                                type="prepend"
                                group={item}
                                onDelete={() => {
                                  setPrependSeq(
                                    prependSeq.filter(
                                      (v) => v.name !== item.name
                                    )
                                  );
                                }}
                              />
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    );
                  } else if (index < filteredGroupList.length + shift) {
                    let newIndex = index - shift;
                    return (
                      <GroupItem
                        key={`${filteredGroupList[newIndex].name}-${index}`}
                        type={
                          deleteSeq.includes(filteredGroupList[newIndex].name)
                            ? "delete"
                            : "original"
                        }
                        group={filteredGroupList[newIndex]}
                        onDelete={() => {
                          if (
                            deleteSeq.includes(filteredGroupList[newIndex].name)
                          ) {
                            setDeleteSeq(
                              deleteSeq.filter(
                                (v) => v !== filteredGroupList[newIndex].name
                              )
                            );
                          } else {
                            setDeleteSeq((prev) => [
                              ...prev,
                              filteredGroupList[newIndex].name,
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
                              <GroupItem
                                key={`${item.name}-${index}`}
                                type="append"
                                group={item}
                                onDelete={() => {
                                  setAppendSeq(
                                    appendSeq.filter(
                                      (v) => v.name !== item.name
                                    )
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
              fontLigatures: true, // 连字符
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
