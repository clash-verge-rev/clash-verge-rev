import { ReactNode, useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import yaml from "js-yaml";
import { useTranslation } from "react-i18next";

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
import { useThemeMode } from "@/services/states";
import { readProfileFile, saveProfileFile } from "@/services/cmds";
import { Notice, Switch } from "@/components/base";
import getSystem from "@/utils/get-system";

import Editor from "@monaco-editor/react";

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

  const themeMode = useThemeMode();
  const [prevData, setPrevData] = useState("");
  const [currData, setCurrData] = useState("");
  const [rule, setRule] = useState("");
  const [ruleType, setRuleType] =
    useState<(typeof RuleTypeList)[number]>("DOMAIN");
  const [ruleContent, setRuleContent] = useState("");
  const [noResolve, setNoResolve] = useState(false);
  const [proxyPolicy, setProxyPolicy] = useState("DIRECT");
  const [proxyPolicyList, setProxyPolicyList] = useState<string[]>([]);
  const [ruleList, setRuleList] = useState<string[]>([]);

  const editorOptions = {
    tabSize: 2,
    minimap: { enabled: false },
    mouseWheelZoom: true,
    quickSuggestions: {
      strings: true,
      comments: true,
      other: true,
    },
    padding: {
      top: 33,
    },
    fontFamily: `Fira Code, JetBrains Mono, Roboto Mono, "Source Code Pro", Consolas, Menlo, Monaco, monospace, "Courier New", "Apple Color Emoji"${
      getSystem() === "windows" ? ", twemoji mozilla" : ""
    }`,
    fontLigatures: true,
    smoothScrolling: true,
  };

  const fetchContent = async () => {
    let data = await readProfileFile(property);
    setCurrData(data);
    setPrevData(data);
  };

  const fetchProfile = async () => {
    let data = await readProfileFile(profileUid);
    let obj = yaml.load(data) as { "proxy-groups": []; proxies: []; rules: [] };
    if (!obj["proxy-groups"]) {
      obj = { "proxy-groups": [], proxies: [], rules: [] };
    }
    setProxyPolicyList(
      BuiltinProxyPolicyList.concat(
        obj["proxy-groups"].map((item: any) => item.name)
      )
    );
    setRuleList(obj.rules);
  };

  const addSeq = async (method: "prepend" | "append" | "delete") => {
    let obj = yaml.load(currData) as ISeqProfileConfig;
    if (!obj.prepend) {
      obj = { prepend: [], append: [], delete: [] };
    }
    switch (method) {
      case "append": {
        obj.append.push(
          `${ruleType}${
            ruleType === "MATCH" ? "" : "," + ruleContent
          },${proxyPolicy}${
            NoResolveList.includes(ruleType) && noResolve ? ",no-resolve" : ""
          }`
        );
        break;
      }
      case "prepend": {
        obj.prepend.push(
          `${ruleType}${
            ruleType === "MATCH" ? "" : "," + ruleContent
          },${proxyPolicy}${
            NoResolveList.includes(ruleType) && noResolve ? ",no-resolve" : ""
          }`
        );
        break;
      }
      case "delete": {
        obj.delete.push(rule);
        break;
      }
    }
    let raw = yaml.dump(obj);

    setCurrData(raw);
  };

  useEffect(() => {
    fetchContent();
    fetchProfile();
  }, [open]);

  const onSave = useLockFn(async () => {
    try {
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
              <TextField
                size="small"
                sx={{ minWidth: "240px" }}
                value={ruleContent}
                placeholder={ExampleMap[ruleType]}
                onChange={(e) => {
                  setRuleContent(e.target.value);
                }}
              />
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
                addSeq("prepend");
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
                addSeq("append");
              }}
            >
              {t("Add Append Rule")}
            </Button>
          </Item>
          <Item>
            <Autocomplete
              fullWidth
              size="small"
              sx={{ minWidth: "240px" }}
              value={rule}
              options={ruleList}
              onChange={(_, v) => {
                if (v) setRule(v);
              }}
              renderInput={(params) => <TextField {...params} />}
            />
          </Item>
          <Item>
            <Button
              fullWidth
              variant="contained"
              onClick={() => {
                addSeq("delete");
              }}
            >
              {t("Delete Rule")}
            </Button>
          </Item>
        </div>
        <div
          style={{
            display: "inline-block",
            width: "50%",
            height: "100%",
            marginLeft: "10px",
          }}
        >
          <Editor
            language="yaml"
            theme={themeMode === "light" ? "vs" : "vs-dark"}
            height="100%"
            value={currData}
            onChange={(value, _) => {
              if (value) setCurrData(value);
            }}
            options={editorOptions}
          />
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
