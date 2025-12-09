import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import MonacoEditor from "@monaco-editor/react";
import {
  VerticalAlignBottomRounded,
  VerticalAlignTopRounded,
} from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
  styled,
} from "@mui/material";
import { useLockFn } from "ahooks";
import yaml from "js-yaml";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

import { Switch } from "@/components/base";
import { RuleItem } from "@/components/profile/rule-item";
import { readProfileFile, saveProfileFile } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import { useThemeMode } from "@/services/states";
import type { TranslationKey } from "@/types/generated/i18n-keys";
import getSystem from "@/utils/get-system";

import { BaseSearchBox } from "../base/base-search-box";

interface Props {
  groupsUid: string;
  mergeUid: string;
  profileUid: string;
  property: string;
  open: boolean;
  onClose: () => void;
  onSave?: (prev?: string, curr?: string) => void;
}

const portValidator = (value: string): boolean => {
  return new RegExp(
    "^(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5])$",
  ).test(value);
};
const ipv4CIDRValidator = (value: string): boolean => {
  return new RegExp(
    "^(?:(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))\\.){3}(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))(?:\\/(?:[12]?[0-9]|3[0-2]))$",
  ).test(value);
};
const ipv6CIDRValidator = (value: string): boolean => {
  return new RegExp(
    "^([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}|::|:(?::[0-9a-fA-F]{1,4}){1,6}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,5}|(?:[0-9a-fA-F]{1,4}:){2}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){3}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){4}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){5}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:)\\/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$",
  ).test(value);
};

const rules: {
  name: string;
  required?: boolean;
  example?: string;
  noResolve?: boolean;
  validator?: (value: string) => boolean;
}[] = [
  {
    name: "DOMAIN",
    example: "example.com",
  },
  {
    name: "DOMAIN-SUFFIX",
    example: "example.com",
  },
  {
    name: "DOMAIN-KEYWORD",
    example: "example",
  },
  {
    name: "DOMAIN-REGEX",
    example: "example.*",
  },
  {
    name: "GEOSITE",
    example: "youtube",
  },
  {
    name: "GEOIP",
    example: "CN",
    noResolve: true,
  },
  {
    name: "SRC-GEOIP",
    example: "CN",
  },
  {
    name: "IP-ASN",
    example: "13335",
    noResolve: true,
    validator: (value) => (+value ? true : false),
  },
  {
    name: "SRC-IP-ASN",
    example: "9808",
    validator: (value) => (+value ? true : false),
  },
  {
    name: "IP-CIDR",
    example: "127.0.0.0/8",
    noResolve: true,
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  },
  {
    name: "IP-CIDR6",
    example: "2620:0:2d0:200::7/32",
    noResolve: true,
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  },
  {
    name: "SRC-IP-CIDR",
    example: "192.168.1.201/32",
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  },
  {
    name: "IP-SUFFIX",
    example: "8.8.8.8/24",
    noResolve: true,
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  },
  {
    name: "SRC-IP-SUFFIX",
    example: "192.168.1.201/8",
    validator: (value) => ipv4CIDRValidator(value) || ipv6CIDRValidator(value),
  },
  {
    name: "SRC-PORT",
    example: "7777",
    validator: (value) => portValidator(value),
  },
  {
    name: "DST-PORT",
    example: "80",
    validator: (value) => portValidator(value),
  },
  {
    name: "IN-PORT",
    example: "7897",
    validator: (value) => portValidator(value),
  },
  {
    name: "DSCP",
    example: "4",
  },
  {
    name: "PROCESS-NAME",
    example: getSystem() === "windows" ? "chrome.exe" : "curl",
  },
  {
    name: "PROCESS-PATH",
    example:
      getSystem() === "windows"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "/usr/bin/wget",
  },
  {
    name: "PROCESS-NAME-REGEX",
    example: ".*telegram.*",
  },
  {
    name: "PROCESS-PATH-REGEX",
    example:
      getSystem() === "windows" ? "(?i).*Application\\chrome.*" : ".*bin/wget",
  },
  {
    name: "NETWORK",
    example: "udp",
    validator: (value) => ["tcp", "udp"].includes(value),
  },
  {
    name: "UID",
    example: "1001",
    validator: (value) => (+value ? true : false),
  },
  {
    name: "IN-TYPE",
    example: "SOCKS/HTTP",
  },
  {
    name: "IN-USER",
    example: "mihomo",
  },
  {
    name: "IN-NAME",
    example: "ss",
  },
  {
    name: "SUB-RULE",
    example: "(NETWORK,tcp)",
  },
  {
    name: "RULE-SET",
    example: "providername",
    noResolve: true,
  },
  {
    name: "AND",
    example: "((DOMAIN,baidu.com),(NETWORK,UDP))",
  },
  {
    name: "OR",
    example: "((NETWORK,UDP),(DOMAIN,baidu.com))",
  },
  {
    name: "NOT",
    example: "((DOMAIN,baidu.com))",
  },
  {
    name: "MATCH",
    required: false,
  },
];

const RULE_TYPE_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  rules.map((rule) => [
    rule.name,
    `rules.modals.editor.ruleTypes.${rule.name}`,
  ]),
);

const builtinProxyPolicies = ["DIRECT", "REJECT", "REJECT-DROP", "PASS"];

const PROXY_POLICY_LABEL_KEYS: Record<string, TranslationKey> =
  builtinProxyPolicies.reduce(
    (acc, policy) => {
      acc[policy] =
        `proxies.components.enums.policies.${policy}` as TranslationKey;
      return acc;
    },
    {} as Record<string, TranslationKey>,
  );

export const RulesEditorViewer = (props: Props) => {
  const { groupsUid, mergeUid, profileUid, property, open, onClose, onSave } =
    props;
  const { t } = useTranslation();
  const themeMode = useThemeMode();

  const [prevData, setPrevData] = useState("");
  const [currData, setCurrData] = useState("");
  const [visualization, setVisualization] = useState(true);
  const [match, setMatch] = useState(() => (_: string) => true);

  const [ruleType, setRuleType] = useState<(typeof rules)[number]>(rules[0]);
  const [ruleContent, setRuleContent] = useState("");
  const [noResolve, setNoResolve] = useState(false);
  const [proxyPolicy, setProxyPolicy] = useState(builtinProxyPolicies[0]);
  const [proxyPolicyList, setProxyPolicyList] = useState<string[]>([]);
  const [ruleList, setRuleList] = useState<string[]>([]);
  const [ruleSetList, setRuleSetList] = useState<string[]>([]);
  const [subRuleList, setSubRuleList] = useState<string[]>([]);

  const [prependSeq, setPrependSeq] = useState<string[]>([]);
  const [appendSeq, setAppendSeq] = useState<string[]>([]);
  const [deleteSeq, setDeleteSeq] = useState<string[]>([]);

  const filteredPrependSeq = useMemo(
    () => prependSeq.filter((rule) => match(rule)),
    [prependSeq, match],
  );
  const filteredRuleList = useMemo(
    () => ruleList.filter((rule) => match(rule)),
    [ruleList, match],
  );
  const filteredAppendSeq = useMemo(
    () => appendSeq.filter((rule) => match(rule)),
    [appendSeq, match],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const reorder = (list: string[], startIndex: number, endIndex: number) => {
    const result = Array.from(list);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };
  const onPrependDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        const activeIndex = prependSeq.indexOf(active.id.toString());
        const overIndex = prependSeq.indexOf(over.id.toString());
        setPrependSeq(reorder(prependSeq, activeIndex, overIndex));
      }
    }
  };
  const onAppendDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        const activeIndex = appendSeq.indexOf(active.id.toString());
        const overIndex = appendSeq.indexOf(over.id.toString());
        setAppendSeq(reorder(appendSeq, activeIndex, overIndex));
      }
    }
  };
  const fetchContent = useCallback(async () => {
    const data = await readProfileFile(property);
    const obj = yaml.load(data) as ISeqProfileConfig | null;

    setPrependSeq(obj?.prepend || []);
    setAppendSeq(obj?.append || []);
    setDeleteSeq(obj?.delete || []);

    setPrevData(data);
    setCurrData(data);
  }, [property]);

  useEffect(() => {
    if (currData === "" || visualization !== true) {
      return;
    }

    const obj = yaml.load(currData) as ISeqProfileConfig | null;
    startTransition(() => {
      setPrependSeq(obj?.prepend ?? []);
      setAppendSeq(obj?.append ?? []);
      setDeleteSeq(obj?.delete ?? []);
    });
  }, [currData, visualization]);

  // 优化：异步处理大数据yaml.dump，避免UI卡死
  useEffect(() => {
    if (!(prependSeq && appendSeq && deleteSeq)) {
      return;
    }

    const serialize = () => {
      try {
        setCurrData(
          yaml.dump(
            { prepend: prependSeq, append: appendSeq, delete: deleteSeq },
            { forceQuotes: true },
          ),
        );
      } catch (error) {
        showNotice.error(error ?? "YAML dump error");
      }
    };
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    if (window.requestIdleCallback) {
      idleId = window.requestIdleCallback(serialize);
    } else {
      timeoutId = window.setTimeout(serialize, 0);
    }
    return () => {
      if (idleId !== undefined && window.cancelIdleCallback) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, [prependSeq, appendSeq, deleteSeq]);

  const fetchProfile = useCallback(async () => {
    const data = await readProfileFile(profileUid); // 原配置文件
    const groupsData = await readProfileFile(groupsUid); // groups配置文件
    const mergeData = await readProfileFile(mergeUid); // merge配置文件
    const globalMergeData = await readProfileFile("Merge"); // global merge配置文件

    const rulesObj = yaml.load(data) as { rules: [] } | null;

    const originGroupsObj = yaml.load(data) as {
      "proxy-groups": IProxyGroupConfig[];
    } | null;
    const originGroups = originGroupsObj?.["proxy-groups"] || [];
    const moreGroupsObj = yaml.load(groupsData) as ISeqProfileConfig | null;
    const rawPrependGroups = moreGroupsObj?.["prepend"];
    const morePrependGroups = Array.isArray(rawPrependGroups)
      ? (rawPrependGroups as IProxyGroupConfig[])
      : [];
    const rawAppendGroups = moreGroupsObj?.["append"];
    const moreAppendGroups = Array.isArray(rawAppendGroups)
      ? (rawAppendGroups as IProxyGroupConfig[])
      : [];
    const rawDeleteGroups = moreGroupsObj?.["delete"];
    const moreDeleteGroups: Array<string | { name: string }> = Array.isArray(
      rawDeleteGroups,
    )
      ? (rawDeleteGroups as Array<string | { name: string }>)
      : [];
    const groups = morePrependGroups.concat(
      originGroups.filter((group: any) => {
        if (group.name) {
          return !moreDeleteGroups.includes(group.name);
        } else {
          return !moreDeleteGroups.includes(group);
        }
      }),
      moreAppendGroups,
    );

    const originRuleSetObj = yaml.load(data) as {
      "rule-providers": Record<string, unknown>;
    } | null;
    const originRuleSet = originRuleSetObj?.["rule-providers"] || {};
    const moreRuleSetObj = yaml.load(mergeData) as {
      "rule-providers": Record<string, unknown>;
    } | null;
    const moreRuleSet = moreRuleSetObj?.["rule-providers"] || {};
    const globalRuleSetObj = yaml.load(globalMergeData) as {
      "rule-providers": Record<string, unknown>;
    } | null;
    const globalRuleSet = globalRuleSetObj?.["rule-providers"] || {};
    const ruleSet = Object.assign(
      {},
      originRuleSet,
      moreRuleSet,
      globalRuleSet,
    );

    const originSubRuleObj = yaml.load(data) as {
      "sub-rules": Record<string, unknown>;
    } | null;
    const originSubRule = originSubRuleObj?.["sub-rules"] || {};
    const moreSubRuleObj = yaml.load(mergeData) as {
      "sub-rules": Record<string, unknown>;
    } | null;
    const moreSubRule = moreSubRuleObj?.["sub-rules"] || {};
    const globalSubRuleObj = yaml.load(globalMergeData) as {
      "sub-rules": Record<string, unknown>;
    } | null;
    const globalSubRule = globalSubRuleObj?.["sub-rules"] || {};
    const subRule = Object.assign(
      {},
      originSubRule,
      moreSubRule,
      globalSubRule,
    );
    setProxyPolicyList(
      builtinProxyPolicies.concat(groups.map((group: any) => group.name)),
    );
    setRuleSetList(Object.keys(ruleSet));
    setSubRuleList(Object.keys(subRule));
    setRuleList(rulesObj?.rules || []);
  }, [groupsUid, mergeUid, profileUid]);

  useEffect(() => {
    if (!open) return;
    fetchContent();
    fetchProfile();
  }, [fetchContent, fetchProfile, open]);

  const validateRule = () => {
    if ((ruleType.required ?? true) && !ruleContent) {
      throw new Error(
        t("rules.modals.editor.form.validation.conditionRequired"),
      );
    }
    if (ruleType.validator && !ruleType.validator(ruleContent)) {
      throw new Error(t("rules.modals.editor.form.validation.invalidRule"));
    }

    const condition = (ruleType.required ?? true) ? ruleContent : "";
    return `${ruleType.name}${condition ? "," + condition : ""},${proxyPolicy}${
      ruleType.noResolve && noResolve ? ",no-resolve" : ""
    }`;
  };

  const handleSave = useLockFn(async () => {
    try {
      await saveProfileFile(property, currData);
      showNotice.success("shared.feedback.notifications.saved");
      onSave?.(prevData, currData);
      onClose();
    } catch (err: any) {
      showNotice.error(err);
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        {
          <Box display="flex" justifyContent="space-between">
            {t("rules.modals.editor.title")}
            <Box>
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  setVisualization((prev) => !prev);
                }}
              >
                {visualization
                  ? t("shared.editorModes.advanced")
                  : t("shared.editorModes.visualization")}
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
              <Item>
                <ListItemText
                  primary={t("rules.modals.editor.form.labels.type")}
                />
                <Autocomplete
                  size="small"
                  sx={{ minWidth: "240px" }}
                  renderInput={(params) => <TextField {...params} />}
                  options={rules}
                  value={ruleType}
                  getOptionLabel={(option) =>
                    t(RULE_TYPE_LABEL_KEYS[option.name] ?? option.name)
                  }
                  renderOption={(props, option) => {
                    const label = t(
                      RULE_TYPE_LABEL_KEYS[option.name] ?? option.name,
                    );
                    return (
                      <li {...props} title={label}>
                        {label}
                      </li>
                    );
                  }}
                  onChange={(_, value) => value && setRuleType(value)}
                />
              </Item>
              <Item
                sx={{ display: !(ruleType.required ?? true) ? "none" : "" }}
              >
                <ListItemText
                  primary={t("rules.modals.editor.form.labels.content")}
                />

                {ruleType.name === "RULE-SET" && (
                  <Autocomplete
                    size="small"
                    sx={{ minWidth: "240px" }}
                    renderInput={(params) => <TextField {...params} />}
                    options={ruleSetList}
                    value={ruleContent}
                    onChange={(_, value) => value && setRuleContent(value)}
                  />
                )}
                {ruleType.name === "SUB-RULE" && (
                  <Autocomplete
                    size="small"
                    sx={{ minWidth: "240px" }}
                    renderInput={(params) => <TextField {...params} />}
                    options={subRuleList}
                    value={ruleContent}
                    onChange={(_, value) => value && setRuleContent(value)}
                  />
                )}
                {ruleType.name !== "RULE-SET" &&
                  ruleType.name !== "SUB-RULE" && (
                    <TextField
                      autoComplete="new-password"
                      size="small"
                      sx={{ minWidth: "240px" }}
                      value={ruleContent}
                      required={ruleType.required ?? true}
                      error={(ruleType.required ?? true) && !ruleContent}
                      placeholder={ruleType.example}
                      onChange={(e) => setRuleContent(e.target.value)}
                    />
                  )}
              </Item>
              <Item>
                <ListItemText
                  primary={t("rules.modals.editor.form.labels.proxyPolicy")}
                />
                <Autocomplete
                  size="small"
                  sx={{ minWidth: "240px" }}
                  renderInput={(params) => <TextField {...params} />}
                  options={proxyPolicyList}
                  value={proxyPolicy}
                  getOptionLabel={(option) =>
                    t(PROXY_POLICY_LABEL_KEYS[option] ?? option)
                  }
                  renderOption={(props, option) => {
                    const label = t(PROXY_POLICY_LABEL_KEYS[option] ?? option);
                    return (
                      <li {...props} title={label}>
                        {label}
                      </li>
                    );
                  }}
                  onChange={(_, value) => value && setProxyPolicy(value)}
                />
              </Item>
              {ruleType.noResolve && (
                <Item>
                  <ListItemText
                    primary={t("rules.modals.editor.form.toggles.noResolve")}
                  />
                  <Switch
                    checked={noResolve}
                    onChange={() => setNoResolve(!noResolve)}
                  />
                </Item>
              )}
              <Item>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<VerticalAlignTopRounded />}
                  onClick={() => {
                    try {
                      const raw = validateRule();
                      if (prependSeq.includes(raw)) return;
                      setPrependSeq([raw, ...prependSeq]);
                    } catch (err: any) {
                      showNotice.error(err);
                    }
                  }}
                >
                  {t("rules.modals.editor.form.actions.prependRule")}
                </Button>
              </Item>
              <Item>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<VerticalAlignBottomRounded />}
                  onClick={() => {
                    try {
                      const raw = validateRule();
                      if (appendSeq.includes(raw)) return;
                      setAppendSeq([...appendSeq, raw]);
                    } catch (err: any) {
                      showNotice.error(err);
                    }
                  }}
                >
                  {t("rules.modals.editor.form.actions.appendRule")}
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
                  filteredRuleList.length +
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
                            return x;
                          })}
                        >
                          {filteredPrependSeq.map((item) => {
                            return (
                              <RuleItem
                                key={item}
                                type="prepend"
                                ruleRaw={item}
                                onDelete={() => {
                                  setPrependSeq(
                                    prependSeq.filter((v) => v !== item),
                                  );
                                }}
                              />
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    );
                  } else if (index < filteredRuleList.length + shift) {
                    const newIndex = index - shift;
                    return (
                      <RuleItem
                        key={filteredRuleList[newIndex]}
                        type={
                          deleteSeq.includes(filteredRuleList[newIndex])
                            ? "delete"
                            : "original"
                        }
                        ruleRaw={filteredRuleList[newIndex]}
                        onDelete={() => {
                          if (deleteSeq.includes(filteredRuleList[newIndex])) {
                            setDeleteSeq(
                              deleteSeq.filter(
                                (v) => v !== filteredRuleList[newIndex],
                              ),
                            );
                          } else {
                            setDeleteSeq((prev) => [
                              ...prev,
                              filteredRuleList[newIndex],
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
                            return x;
                          })}
                        >
                          {filteredAppendSeq.map((item) => {
                            return (
                              <RuleItem
                                key={item}
                                type="append"
                                ruleRaw={item}
                                onDelete={() => {
                                  setAppendSeq(
                                    appendSeq.filter((v) => v !== item),
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
            theme={themeMode === "light" ? "light" : "vs-dark"}
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
            onChange={(value) => setCurrData(value ?? "")}
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          {t("shared.actions.cancel")}
        </Button>

        <Button onClick={handleSave} variant="contained">
          {t("shared.actions.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
}));
