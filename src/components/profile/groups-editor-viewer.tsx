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
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  TextField,
  styled,
} from "@mui/material";
import { useLockFn } from "ahooks";
import {
  cancelIdleCallback,
  requestIdleCallback,
} from "foxact/request-idle-callback";
import yaml from "js-yaml";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";

import { Switch } from "@/components/base";
import { GroupItem } from "@/components/profile/group-item";
import {
  getNetworkInterfaces,
  readProfileFile,
  saveProfileFile,
} from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import { useThemeMode } from "@/services/states";
import type { TranslationKey } from "@/types/generated/i18n-keys";
import getSystem from "@/utils/get-system";

import { BaseSearchBox } from "../base/base-search-box";

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

const PROXY_STRATEGY_LABEL_KEYS: Record<string, TranslationKey> = {
  select: "proxies.components.enums.strategies.select",
  "url-test": "proxies.components.enums.strategies.url-test",
  fallback: "proxies.components.enums.strategies.fallback",
  "load-balance": "proxies.components.enums.strategies.load-balance",
  relay: "proxies.components.enums.strategies.relay",
};

const PROXY_POLICY_LABEL_KEYS: Record<string, TranslationKey> =
  builtinProxyPolicies.reduce(
    (acc, policy) => {
      acc[policy] =
        `proxies.components.enums.policies.${policy}` as TranslationKey;
      return acc;
    },
    {} as Record<string, TranslationKey>,
  );

const normalizeDeleteSeq = (input?: unknown): string[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  const names = input
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        item &&
        typeof item === "object" &&
        "name" in item &&
        typeof (item as { name: unknown }).name === "string"
      ) {
        return (item as { name: string }).name;
      }

      return undefined;
    })
    .filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );

  return Array.from(new Set(names));
};

const buildGroupsYaml = (
  prepend: IProxyGroupConfig[],
  append: IProxyGroupConfig[],
  deleteList: string[],
) => {
  return yaml.dump(
    {
      prepend,
      append,
      delete: deleteList,
    },
    { forceQuotes: true },
  );
};

export const GroupsEditorViewer = (props: Props) => {
  const { mergeUid, proxiesUid, profileUid, property, open, onClose, onSave } =
    props;
  const { t } = useTranslation();
  const translateStrategy = useCallback(
    (value: string) =>
      PROXY_STRATEGY_LABEL_KEYS[value]
        ? t(PROXY_STRATEGY_LABEL_KEYS[value])
        : value,
    [t],
  );
  const translatePolicy = useCallback(
    (value: string) =>
      PROXY_POLICY_LABEL_KEYS[value]
        ? t(PROXY_POLICY_LABEL_KEYS[value])
        : value,
    [t],
  );
  const themeMode = useThemeMode();
  const [prevData, setPrevData] = useState("");
  const [currData, setCurrData] = useState("");
  const [visualization, setVisualization] = useState(true);
  const [match, setMatch] = useState(() => (_: string) => true);
  const [interfaceNameList, setInterfaceNameList] = useState<string[]>([]);
  const { control, ...formIns } = useForm<IProxyGroupConfig>({
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
    [prependSeq, match],
  );
  const filteredGroupList = useMemo(
    () => groupList.filter((group) => match(group.name)),
    [groupList, match],
  );
  const filteredAppendSeq = useMemo(
    () => appendSeq.filter((group) => match(group.name)),
    [appendSeq, match],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const reorder = (
    list: IProxyGroupConfig[],
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
  const fetchContent = useCallback(async () => {
    const data = await readProfileFile(property);
    const obj = yaml.load(data) as ISeqProfileConfig | null;

    setPrependSeq(obj?.prepend || []);
    setAppendSeq(obj?.append || []);
    setDeleteSeq((prev) => {
      const normalized = normalizeDeleteSeq(obj?.delete);
      if (
        normalized.length === prev.length &&
        normalized.every((item, index) => item === prev[index])
      ) {
        return prev;
      }
      return normalized;
    });

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
      setDeleteSeq((prev) => {
        const normalized = normalizeDeleteSeq(obj?.delete);
        if (
          normalized.length === prev.length &&
          normalized.every((item, index) => item === prev[index])
        ) {
          return prev;
        }
        return normalized;
      });
    });
  }, [currData, visualization]);

  // 优化：异步处理大数据yaml.dump，避免UI卡死
  useEffect(() => {
    if (prependSeq && appendSeq && deleteSeq) {
      const serialize = () => {
        try {
          setCurrData(buildGroupsYaml(prependSeq, appendSeq, deleteSeq));
        } catch (e) {
          console.warn("[GroupsEditorViewer] yaml.dump failed:", e);
          // 防止异常导致UI卡死
        }
      };

      const handle = requestIdleCallback(serialize);
      return () => {
        cancelIdleCallback(handle);
      };
    }
  }, [prependSeq, appendSeq, deleteSeq]);

  const fetchProxyPolicy = useCallback(async () => {
    const data = await readProfileFile(profileUid);
    const proxiesData = await readProfileFile(proxiesUid);
    const originGroupsObj = yaml.load(data) as {
      "proxy-groups": IProxyGroupConfig[];
    } | null;

    const originProxiesObj = yaml.load(data) as { proxies: [] } | null;
    const originProxies = originProxiesObj?.proxies || [];
    const moreProxiesObj = yaml.load(proxiesData) as ISeqProfileConfig | null;
    const morePrependProxies = moreProxiesObj?.prepend || [];
    const moreAppendProxies = moreProxiesObj?.append || [];
    const moreDeleteProxies = normalizeDeleteSeq(moreProxiesObj?.delete);

    const proxies = morePrependProxies.concat(
      originProxies.filter((proxy: any) => {
        const proxyName =
          typeof proxy === "string"
            ? proxy
            : (proxy?.name as string | undefined);
        return proxyName ? !moreDeleteProxies.includes(proxyName) : true;
      }),
      moreAppendProxies,
    );

    const proxyNames = proxies
      .map((proxy: any) =>
        typeof proxy === "string" ? proxy : (proxy?.name as string | undefined),
      )
      .filter(
        (name): name is string => typeof name === "string" && name.length > 0,
      );

    const computedPolicyList = builtinProxyPolicies.concat(
      prependSeq.map((group: IProxyGroupConfig) => group.name),
      (originGroupsObj?.["proxy-groups"] || [])
        .map((group: IProxyGroupConfig) => group.name)
        .filter((name) => !deleteSeq.includes(name)),
      appendSeq.map((group: IProxyGroupConfig) => group.name),
      proxyNames,
    );

    setProxyPolicyList(Array.from(new Set(computedPolicyList)));
  }, [appendSeq, deleteSeq, prependSeq, profileUid, proxiesUid]);
  const fetchProfile = useCallback(async () => {
    const data = await readProfileFile(profileUid);
    const mergeData = await readProfileFile(mergeUid);
    const globalMergeData = await readProfileFile("Merge");

    const originGroupsObj = yaml.load(data) as {
      "proxy-groups": IProxyGroupConfig[];
    } | null;

    const originProviderObj = yaml.load(data) as {
      "proxy-providers": Record<string, unknown>;
    } | null;
    const originProvider = originProviderObj?.["proxy-providers"] || {};

    const moreProviderObj = yaml.load(mergeData) as {
      "proxy-providers": Record<string, unknown>;
    } | null;
    const moreProvider = moreProviderObj?.["proxy-providers"] || {};

    const globalProviderObj = yaml.load(globalMergeData) as {
      "proxy-providers": Record<string, unknown>;
    } | null;
    const globalProvider = globalProviderObj?.["proxy-providers"] || {};

    const provider = Object.assign(
      {},
      originProvider,
      moreProvider,
      globalProvider,
    );

    setProxyProviderList(Object.keys(provider));
    setGroupList(originGroupsObj?.["proxy-groups"] || []);
  }, [mergeUid, profileUid]);
  const getInterfaceNameList = useCallback(async () => {
    const list = await getNetworkInterfaces();
    setInterfaceNameList(list);
  }, []);
  useEffect(() => {
    if (!open) return;
    fetchProxyPolicy();
  }, [fetchProxyPolicy, open]);

  useEffect(() => {
    if (!open) return;
    fetchContent();
    fetchProfile();
    getInterfaceNameList();
  }, [fetchContent, fetchProfile, getInterfaceNameList, open]);

  const validateGroup = () => {
    const group = formIns.getValues();
    if (group.name === "") {
      throw new Error(t("profiles.modals.groupsEditor.errors.nameRequired"));
    }
  };

  const handleSave = useLockFn(async () => {
    try {
      const nextData = visualization
        ? buildGroupsYaml(prependSeq, appendSeq, deleteSeq)
        : currData;

      if (visualization) {
        setCurrData(nextData);
      }

      await saveProfileFile(property, nextData);
      showNotice.success("shared.feedback.notifications.saved");
      setPrevData(nextData);
      onSave?.(prevData, nextData);
      onClose();
    } catch (err) {
      showNotice.error(err);
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>
        {
          <Box display="flex" justifyContent="space-between">
            {t("profiles.modals.groupsEditor.title")}
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
                      <ListItemText
                        primary={t("profiles.modals.groupsEditor.fields.type")}
                      />
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
                        getOptionLabel={translateStrategy}
                        renderOption={(props, option) => (
                          <li {...props} title={translateStrategy(option)}>
                            {translateStrategy(option)}
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
                      <ListItemText
                        primary={t("profiles.modals.groupsEditor.fields.name")}
                      />
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
                      <ListItemText
                        primary={t("profiles.modals.groupsEditor.fields.icon")}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.proxies",
                        )}
                      />
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
                          <li {...props} title={translatePolicy(option)}>
                            {translatePolicy(option)}
                          </li>
                        )}
                        getOptionLabel={translatePolicy}
                      />
                    </Item>
                  )}
                />
                <Controller
                  name="use"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.provider",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.healthCheckUrl",
                        )}
                      />
                      <TextField
                        autoComplete="new-password"
                        placeholder="https://cp.cloudflare.com/generate_204"
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.expectedStatus",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.interval",
                        )}
                      />
                      <TextField
                        autoComplete="new-password"
                        placeholder="300"
                        type="number"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                        }}
                        slotProps={{
                          input: {
                            endAdornment: (
                              <InputAdornment position="end">
                                {t("shared.units.seconds")}
                              </InputAdornment>
                            ),
                          },
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
                      <ListItemText primary={t("shared.labels.timeout")} />
                      <TextField
                        autoComplete="new-password"
                        placeholder="5000"
                        type="number"
                        size="small"
                        sx={{ width: "calc(100% - 150px)" }}
                        onChange={(e) => {
                          field.onChange(parseInt(e.target.value));
                        }}
                        slotProps={{
                          input: {
                            endAdornment: (
                              <InputAdornment position="end">
                                {t("shared.units.milliseconds")}
                              </InputAdornment>
                            ),
                          },
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.maxFailedTimes",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.interfaceName",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.routingMark",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.filter",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.excludeFilter",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.excludeType",
                        )}
                      />
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
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.includeAll",
                        )}
                      />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="include-all-proxies"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.includeAllProxies",
                        )}
                      />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="include-all-providers"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.fields.includeAllProviders",
                        )}
                      />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="lazy"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText
                        primary={t("profiles.modals.groupsEditor.toggles.lazy")}
                      />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="disable-udp"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.toggles.disableUdp",
                        )}
                      />
                      <Switch checked={field.value} {...field} />
                    </Item>
                  )}
                />
                <Controller
                  name="hidden"
                  control={control}
                  render={({ field }) => (
                    <Item>
                      <ListItemText
                        primary={t(
                          "profiles.modals.groupsEditor.toggles.hidden",
                        )}
                      />
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
                          throw new Error(
                            t("profiles.modals.groupsEditor.errors.nameExists"),
                          );
                        }
                      }
                      setPrependSeq([formIns.getValues(), ...prependSeq]);
                    } catch (err) {
                      showNotice.error(err);
                    }
                  }}
                >
                  {t("profiles.modals.groupsEditor.actions.prepend")}
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
                          throw new Error(
                            t("profiles.modals.groupsEditor.errors.nameExists"),
                          );
                        }
                      }
                      setAppendSeq([...appendSeq, formIns.getValues()]);
                    } catch (err) {
                      showNotice.error(err);
                    }
                  }}
                >
                  {t("profiles.modals.groupsEditor.actions.append")}
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
                          {filteredPrependSeq.map((item) => {
                            return (
                              <GroupItem
                                key={item.name}
                                type="prepend"
                                group={item}
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
                  } else if (index < filteredGroupList.length + shift) {
                    const newIndex = index - shift;
                    return (
                      <GroupItem
                        key={filteredGroupList[newIndex].name}
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
                                (v) => v !== filteredGroupList[newIndex].name,
                              ),
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
                          {filteredAppendSeq.map((item) => {
                            return (
                              <GroupItem
                                key={item.name}
                                type="append"
                                group={item}
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
