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

interface Props {
  profileUid: string;
  title?: string | ReactNode;
  property: string;
  open: boolean;
  onClose: () => void;
  onChange?: (prev?: string, curr?: string) => void;
}

const RuleTypeList = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-REGEX",
  "GEOSITE",
  "IP-CIDR",
  "IP-SUFFIX",
  "IP-ASN",
  "GEOIP",
  "SRC-GEOIP",
  "SRC-IP-ASN",
  "SRC-IP-CIDR",
  "SRC-IP-SUFFIX",
  "DST-PORT",
  "SRC-PORT",
  "IN-PORT",
  "IN-TYPE",
  "IN-USER",
  "IN-NAME",
  "PROCESS-PATH",
  "PROCESS-PATH-REGEX",
  "PROCESS-NAME",
  "PROCESS-NAME-REGEX",
  "UID",
  "NETWORK",
  "DSCP",
  "RULE-SET",
  "SUB-RULE",
  "AND",
  "OR",
  "NOT",
  "MATCH",
] as const;

const NoResolveList = [
  "GEOIP",
  "IP-ASN",
  "IP-CIDR",
  "IP-CIDR6",
  "IP-SUFFIX",
  "RULE-SET",
];
const ExampleMap = {
  DOMAIN: "example.com",
  "DOMAIN-SUFFIX": "example.com",
  "DOMAIN-KEYWORD": "example",
  "DOMAIN-REGEX": "example.*",
  GEOSITE: "youtube",
  "IP-CIDR": "127.0.0.0/8",
  "IP-SUFFIX": "8.8.8.8/24",
  "IP-ASN": "13335",
  GEOIP: "CN",
  "SRC-GEOIP": "cn",
  "SRC-IP-ASN": "9808",
  "SRC-IP-CIDR": "192.168.1.201/32",
  "SRC-IP-SUFFIX": "192.168.1.201/8",
  "DST-PORT": "80",
  "SRC-PORT": "7777",
  "IN-PORT": "7890",
  "IN-TYPE": "SOCKS/HTTP",
  "IN-USER": "mihomo",
  "IN-NAME": "ss",
  "PROCESS-PATH":
    getSystem() === "windows"
      ? "C:Program FilesGoogleChromeApplicationchrome.exe"
      : "/usr/bin/wget",
  "PROCESS-PATH-REGEX":
    getSystem() === "windows" ? "(?i).*Application\\chrome.*" : ".*bin/wget",
  "PROCESS-NAME": getSystem() === "windows" ? "chrome.exe" : "curl",
  "PROCESS-NAME-REGEX": ".*telegram.*",
  UID: "1001",
  NETWORK: "udp",
  DSCP: "4",
  "RULE-SET": "providername",
  "SUB-RULE": "",
  AND: "((DOMAIN,baidu.com),(NETWORK,UDP))",
  OR: "((NETWORK,UDP),(DOMAIN,baidu.com))",
  NOT: "((DOMAIN,baidu.com))",
  MATCH: "",
};

const BuiltinProxyPolicyList = ["DIRECT", "REJECT", "REJECT-DROP", "PASS"];

export const RulesEditorViewer = (props: Props) => {
  const { title, profileUid, property, open, onClose, onChange } = props;
  const { t } = useTranslation();

  const [prevData, setPrevData] = useState("");
  const [ruleType, setRuleType] =
    useState<(typeof RuleTypeList)[number]>("DOMAIN");
  const [ruleContent, setRuleContent] = useState("");
  const [noResolve, setNoResolve] = useState(false);
  const [proxyPolicy, setProxyPolicy] = useState("DIRECT");
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
      BuiltinProxyPolicyList.concat(
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

  const onSave = useLockFn(async () => {
    try {
      let currData = yaml.dump({
        prepend: prependSeq,
        append: appendSeq,
        delete: deleteSeq,
      });
      await saveProfileFile(property, currData);
      onChange?.(prevData, currData);
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
                value={ruleType}
                options={RuleTypeList}
                onChange={(_, v) => {
                  if (v) setRuleType(v);
                }}
                renderInput={(params) => <TextField {...params} />}
              />
            </Item>
            <Item>
              <ListItemText primary={t("Rule Content")} />
              {ruleType === "RULE-SET" && (
                <Autocomplete
                  size="small"
                  sx={{ minWidth: "240px" }}
                  value={ruleContent}
                  options={ruleSetList}
                  onChange={(_, v) => {
                    if (v) setRuleContent(v);
                  }}
                  renderInput={(params) => <TextField {...params} />}
                />
              )}
              {ruleType === "SUB-RULE" && (
                <Autocomplete
                  size="small"
                  sx={{ minWidth: "240px" }}
                  value={ruleContent}
                  options={subRuleList}
                  onChange={(_, v) => {
                    if (v) setRuleContent(v);
                  }}
                  renderInput={(params) => <TextField {...params} />}
                />
              )}
              {ruleType !== "RULE-SET" && ruleType !== "SUB-RULE" && (
                <TextField
                  size="small"
                  sx={{ minWidth: "240px" }}
                  value={ruleContent}
                  placeholder={ExampleMap[ruleType]}
                  onChange={(e) => {
                    setRuleContent(e.target.value);
                  }}
                />
              )}
            </Item>
            <Item>
              <ListItemText primary={t("Proxy Policy")} />
              <Autocomplete
                size="small"
                sx={{ minWidth: "240px" }}
                value={proxyPolicy}
                options={proxyPolicyList}
                onChange={(_, v) => {
                  if (v) setProxyPolicy(v);
                }}
                renderInput={(params) => <TextField {...params} />}
              />
            </Item>
            {NoResolveList.includes(ruleType) && (
              <Item>
                <ListItemText primary={t("No Resolve")} />
                <Switch
                  checked={noResolve}
                  onChange={() => {
                    setNoResolve(!noResolve);
                  }}
                />
              </Item>
            )}
          </List>
          <Item>
            <Button
              fullWidth
              variant="contained"
              onClick={() => {
                let raw = `${ruleType}${
                  ruleType === "MATCH" ? "" : "," + ruleContent
                },${proxyPolicy}${
                  NoResolveList.includes(ruleType) && noResolve
                    ? ",no-resolve"
                    : ""
                }`;
                if (prependSeq.includes(raw)) return;
                setPrependSeq([...prependSeq, raw]);
              }}
            >
              {t("Add Prepend Rule")}
            </Button>
          </Item>
          <Item>
            <Button
              fullWidth
              variant="contained"
              onClick={() => {
                let raw = `${ruleType}${
                  ruleType === "MATCH" ? "" : "," + ruleContent
                },${proxyPolicy}${
                  NoResolveList.includes(ruleType) && noResolve
                    ? ",no-resolve"
                    : ""
                }`;
                if (appendSeq.includes(raw)) return;
                setAppendSeq([...appendSeq, raw]);
              }}
            >
              {t("Add Append Rule")}
            </Button>
          </Item>
        </div>
        <div
          style={{
            display: "inline-block",
            width: "50%",
            height: "100%",
            overflow: "auto",
            marginLeft: "10px",
          }}
        >
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
            {ruleList.map((item, index) => {
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

        <Button onClick={onSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
}));
