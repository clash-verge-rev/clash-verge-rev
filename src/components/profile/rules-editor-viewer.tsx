import { ReactNode, useEffect, useState, useRef, useCallback } from "react";
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
  MenuItem,
  Select,
  TextField,
  styled,
} from "@mui/material";
import { useThemeMode } from "@/services/states";
import { readProfileFile, saveProfileFile } from "@/services/cmds";
import { Notice } from "@/components/base";
import getSystem from "@/utils/get-system";

import MonacoEditor from "react-monaco-editor";
import * as monaco from "monaco-editor";
import { nanoid } from "nanoid";

interface Props {
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
  "MATCH",
];

export const RulesEditorViewer = (props: Props) => {
  const { title, property, open, onClose, onChange } = props;
  const { t } = useTranslation();

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor>(); // 编辑器实例
  const monacoRef = useRef<typeof monaco>(); // monaco 实例
  const monacoHoverProviderRef = useRef<monaco.IDisposable>(); // monaco 注册缓存
  const monacoCompletionItemProviderRef = useRef<monaco.IDisposable>(); // monaco 注册缓存

  // 获取编辑器实例
  const editorDidMountHandle = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monacoIns: typeof monaco) => {
      editorRef.current = editor;
      monacoRef.current = monacoIns;
    },
    []
  );

  const themeMode = useThemeMode();
  const [prevData, setPrevData] = useState("");
  const [currData, setCurrData] = useState("");
  const [method, setMethod] = useState("append");
  const [ruleType, setRuleType] = useState("DOMAIN");
  const [ruleContent, setRuleContent] = useState("");
  const [proxyPolicy, setProxyPolicy] = useState("");

  const uri = monaco.Uri.parse(`${nanoid()}`);
  const model = monaco.editor.createModel(prevData, "yaml", uri);

  const fetchContent = async () => {
    let data = await readProfileFile(property);
    setCurrData(data);
    setPrevData(data);
  };

  const addSeq = async () => {
    let obj = yaml.load(currData) as ISeqProfileConfig;
    if (!obj.prepend) {
      obj = { prepend: [], append: [], delete: [] };
    }
    switch (method) {
      case "append": {
        obj.append.push(`${ruleType},${ruleContent},${proxyPolicy}`);
        break;
      }
      case "prepend": {
        obj.prepend.push(`${ruleType},${ruleContent},${proxyPolicy}`);
        break;
      }
      case "delete": {
        obj.delete.push(`${ruleType},${ruleContent},${proxyPolicy}`);
        break;
      }
    }
    let raw = yaml.dump(obj);

    await saveProfileFile(property, raw);
    setCurrData(raw);
  };

  useEffect(() => {
    fetchContent();
  }, []);

  useEffect(() => {
    return () => {
      if (editorRef.current) {
        editorRef.current.dispose();
      }
      monacoCompletionItemProviderRef.current?.dispose();
      monacoHoverProviderRef.current?.dispose();
    };
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
      <DialogTitle>{title ?? t("Edit File")}</DialogTitle>

      <DialogContent sx={{ display: "flex", width: "auto", height: "100vh" }}>
        <div
          style={{
            width: "50%",
            height: "100%",
          }}
        >
          <List>
            <Item>
              <ListItemText primary={t("Add Method")} />
              <Select
                size="small"
                sx={{ width: "100px" }}
                value={method}
                onChange={(e) => {
                  setMethod(e.target.value);
                }}
              >
                <MenuItem key="prepend" value="prepend">
                  <span style={{ fontSize: 14 }}>Prepend</span>
                </MenuItem>
                <MenuItem key="append" value="append">
                  <span style={{ fontSize: 14 }}>Append</span>
                </MenuItem>
                <MenuItem key="delete" value="delete">
                  <span style={{ fontSize: 14 }}>Delete</span>
                </MenuItem>
              </Select>
            </Item>
            <Item>
              <ListItemText primary={t("Rule Type")} />
              <Autocomplete
                size="small"
                sx={{ width: "300px" }}
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
                value={ruleContent}
                onChange={(e) => {
                  setRuleContent(e.target.value);
                }}
              />
            </Item>
            <Item>
              <ListItemText primary={t("Proxy Policy")} />
              <TextField
                size="small"
                value={proxyPolicy}
                onChange={(e) => {
                  setProxyPolicy(e.target.value);
                }}
              />
            </Item>
          </List>
          <Button fullWidth variant="contained" onClick={addSeq}>
            Add
          </Button>
        </div>
        <div
          style={{
            display: "inline-block",
            width: "50%",
            height: "100%",
          }}
        >
          <MonacoEditor
            language="yaml"
            theme={themeMode === "light" ? "vs" : "vs-dark"}
            height="100%"
            value={currData}
            onChange={setCurrData}
            options={{
              model,
              tabSize: 2,
              minimap: { enabled: false }, // 超过一定宽度显示minimap滚动条
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
            editorDidMount={editorDidMountHandle}
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
