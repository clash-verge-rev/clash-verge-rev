import { ReactNode, useEffect, useState } from "react";
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
  List,
  ListItem,
  ListItemText,
  TextField,
  styled,
} from "@mui/material";

import { readProfileFile, saveProfileFile } from "@/services/cmds";
import { Notice, Switch } from "@/components/base";
import getSystem from "@/utils/get-system";
import { RuleItem } from "@/components/profile/rule-item";
import { BaseSearchBox } from "../base/base-search-box";

interface Props {
  profileUid: string;
  title?: string | ReactNode;
  property: string;
  open: boolean;
  onClose: () => void;
  onSave?: (prev?: string, curr?: string) => void;
}

const portValidator = (value: string): boolean => {
  return new RegExp(
    "^(?:[1-9]\\d{0,3}|[1-5]\\d{4}|6[0-4]\\d{3}|65[0-4]\\d{2}|655[0-2]\\d|6553[0-5])$"
  ).test(value);
};
const ipv4CIDRValidator = (value: string): boolean => {
  return new RegExp(
    "^(?:(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))\\.){3}(?:[1-9]?[0-9]|1[0-9][0-9]|2(?:[0-4][0-9]|5[0-5]))(?:\\/(?:[12]?[0-9]|3[0-2]))$"
  ).test(value);
};
const ipv6CIDRValidator = (value: string): boolean => {
  return new RegExp(
    "^([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7}|::|:(?::[0-9a-fA-F]{1,4}){1,6}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,5}|(?:[0-9a-fA-F]{1,4}:){2}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){3}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){4}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){5}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,6}:)\\/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$"
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
    example: "7890",
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

const builtinProxyPolicies = ["DIRECT", "REJECT", "REJECT-DROP", "PASS"];

export const RulesEditorViewer = (props: Props) => {
  const { title, profileUid, property, open, onClose, onSave } = props;
  const { t } = useTranslation();

  const [prevData, setPrevData] = useState("");
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
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
        let activeIndex = prependSeq.indexOf(active.id.toString());
        let overIndex = prependSeq.indexOf(over.id.toString());
        setPrependSeq(reorder(prependSeq, activeIndex, overIndex));
      }
    }
  };
  const onAppendDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        let activeIndex = appendSeq.indexOf(active.id.toString());
        let overIndex = appendSeq.indexOf(over.id.toString());
        setAppendSeq(reorder(appendSeq, activeIndex, overIndex));
      }
    }
  };
  const fetchContent = async () => {
    let data = await readProfileFile(property);
    let obj = yaml.load(data) as { prepend: []; append: []; delete: [] };

    setPrependSeq(obj.prepend || []);
    setAppendSeq(obj.append || []);
    setDeleteSeq(obj.delete || []);
    setPrevData(data);
  };

  const fetchProfile = async () => {
    let data = await readProfileFile(profileUid);
    let groupsObj = yaml.load(data) as { "proxy-groups": [] };
    let rulesObj = yaml.load(data) as { rules: [] };
    let ruleSetObj = yaml.load(data) as { "rule-providers": [] };
    let subRuleObj = yaml.load(data) as { "sub-rules": [] };
    setProxyPolicyList(
      builtinProxyPolicies.concat(
        groupsObj["proxy-groups"]
          ? groupsObj["proxy-groups"].map((item: any) => item.name)
          : []
      )
    );
    setRuleList(rulesObj.rules || []);
    setRuleSetList(
      ruleSetObj["rule-providers"]
        ? Object.keys(ruleSetObj["rule-providers"])
        : []
    );
    setSubRuleList(
      subRuleObj["sub-rules"] ? Object.keys(subRuleObj["sub-rules"]) : []
    );
  };

  useEffect(() => {
    fetchContent();
    fetchProfile();
  }, [open]);

  const validateRule = () => {
    if ((ruleType.required ?? true) && !ruleContent) {
      throw new Error(t("Rule Condition Required"));
    }
    if (ruleType.validator && !ruleType.validator(ruleContent)) {
      throw new Error(t("Invalid Rule"));
    }

    return `${ruleType.name}${
      ruleContent ? "," + ruleContent : ""
    },${proxyPolicy}${ruleType.noResolve && noResolve ? ",no-resolve" : ""}`;
  };

  const handleSave = useLockFn(async () => {
    try {
      let currData = yaml.dump({
        prepend: prependSeq,
        append: appendSeq,
        delete: deleteSeq,
      });
      await saveProfileFile(property, currData);
      onSave?.(prevData, currData);
      onClose();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      <DialogTitle>{title ?? t("Edit Rules")}</DialogTitle>

      <DialogContent sx={{ display: "flex", width: "auto", height: "100vh" }}>
        <div
          style={{
            width: "50%",
            height: "100%",
          }}
        >
          <List>
            <Item>
              <ListItemText primary={t("Rule Type")} />
              <Autocomplete
                size="small"
                sx={{ minWidth: "240px" }}
                renderInput={(params) => <TextField {...params} />}
                options={rules}
                value={ruleType}
                getOptionLabel={(option) => option.name}
                renderOption={(props, option) => (
                  <li {...props} title={t(option.name)}>
                    {option.name}
                  </li>
                )}
                onChange={(_, value) => value && setRuleType(value)}
              />
            </Item>
            <Item sx={{ display: !(ruleType.required ?? true) ? "none" : "" }}>
              <ListItemText primary={t("Rule Content")} />

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
              {ruleType.name !== "RULE-SET" && ruleType.name !== "SUB-RULE" && (
                <TextField
                  autoComplete="off"
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
              <ListItemText primary={t("Proxy Policy")} />
              <Autocomplete
                size="small"
                sx={{ minWidth: "240px" }}
                renderInput={(params) => <TextField {...params} />}
                options={proxyPolicyList}
                value={proxyPolicy}
                renderOption={(props, option) => (
                  <li {...props} title={t(option)}>
                    {option}
                  </li>
                )}
                onChange={(_, value) => value && setProxyPolicy(value)}
              />
            </Item>
            {ruleType.noResolve && (
              <Item>
                <ListItemText primary={t("No Resolve")} />
                <Switch
                  checked={noResolve}
                  onChange={() => setNoResolve(!noResolve)}
                />
              </Item>
            )}
          </List>
          <Item>
            <Button
              fullWidth
              variant="contained"
              onClick={() => {
                try {
                  let raw = validateRule();
                  console.log(raw);

                  if (prependSeq.includes(raw)) return;
                  setPrependSeq([...prependSeq, raw]);
                } catch (err: any) {
                  Notice.error(err.message || err.toString());
                }
              }}
            >
              {t("Prepend Rule")}
            </Button>
          </Item>
          <Item>
            <Button
              fullWidth
              variant="contained"
              onClick={() => {
                try {
                  let raw = validateRule();
                  if (appendSeq.includes(raw)) return;
                  setPrependSeq([...appendSeq, raw]);
                } catch (err: any) {
                  Notice.error(err.message || err.toString());
                }
              }}
            >
              {t("Append Rule")}
            </Button>
          </Item>
        </div>
        <div
          style={{
            display: "inline-block",
            width: "50%",
            height: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            padding: "0 10px",
          }}
        >
          <div style={{ position: "sticky", top: 0, zIndex: 10 }}>
            <BaseSearchBox
              matchCase={false}
              onSearch={(match) => setMatch(() => match)}
            />
          </div>
          {prependSeq.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onPrependDragEnd}
            >
              <List sx={{ borderBottom: "solid 1px var(--divider-color)" }}>
                <SortableContext
                  items={prependSeq.map((x) => {
                    return x;
                  })}
                >
                  {prependSeq.map((item, index) => {
                    return (
                      <RuleItem
                        key={`${item}-${index}`}
                        type="prepend"
                        ruleRaw={item}
                        onDelete={() => {
                          setPrependSeq(prependSeq.filter((v) => v !== item));
                        }}
                      />
                    );
                  })}
                </SortableContext>
              </List>
            </DndContext>
          )}

          <List>
            {ruleList
              .filter((item) => match(item))
              .map((item, index) => {
                return (
                  <RuleItem
                    key={`${item}-${index}`}
                    type={deleteSeq.includes(item) ? "delete" : "original"}
                    ruleRaw={item}
                    onDelete={() => {
                      if (deleteSeq.includes(item)) {
                        setDeleteSeq(deleteSeq.filter((v) => v !== item));
                      } else {
                        setDeleteSeq([...deleteSeq, item]);
                      }
                    }}
                  />
                );
              })}
          </List>

          {appendSeq.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onAppendDragEnd}
            >
              <SortableContext
                items={appendSeq.map((x) => {
                  return x;
                })}
              >
                <List sx={{ borderTop: "solid 1px var(--divider-color)" }}>
                  {appendSeq.map((item, index) => {
                    return (
                      <RuleItem
                        key={`${item}-${index}`}
                        type="append"
                        ruleRaw={item}
                        onDelete={() => {
                          setAppendSeq(appendSeq.filter((v) => v !== item));
                        }}
                      />
                    );
                  })}
                </List>
              </SortableContext>
            </DndContext>
          )}
        </div>
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
