import MonacoEditor from "@monaco-editor/react";
import { RestartAltRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  FormControl,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  styled,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useLockFn } from "ahooks";
import yaml from "js-yaml";
import type { Ref } from "react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { useClash } from "@/hooks/use-clash";
import { showNotice } from "@/services/notice-service";
import { useThemeMode } from "@/services/states";
import { debugLog } from "@/utils/debug";
import getSystem from "@/utils/get-system";

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
  "& textarea": {
    lineHeight: 1.5,
    fontSize: 14,
    resize: "vertical",
  },
}));

type NameserverPolicy = Record<string, any>;

function parseNameserverPolicy(str: string): NameserverPolicy {
  const result: NameserverPolicy = {};
  if (!str) return result;

  const ruleRegex = /\s*([^=]+?)\s*=\s*([^,]+)(?:,|$)/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(str)) !== null) {
    const [, domainsPart, serversPart] = match;

    const domains = [domainsPart.trim()];
    const servers = serversPart.split(";").map((s) => s.trim());

    domains.forEach((domain) => {
      result[domain] = servers;
    });
  }

  return result;
}

function formatNameserverPolicy(policy: unknown): string {
  if (!policy || typeof policy !== "object") return "";

  return Object.entries(policy as Record<string, unknown>)
    .map(([domain, servers]) => {
      const serversStr = Array.isArray(servers) ? servers.join(";") : servers;
      return `${domain}=${serversStr}`;
    })
    .join(", ");
}

function formatHosts(hosts: unknown): string {
  if (!hosts || typeof hosts !== "object") return "";

  const result: string[] = [];

  Object.entries(hosts as Record<string, unknown>).forEach(
    ([domain, value]) => {
      if (Array.isArray(value)) {
        const ipsStr = value.join(";");
        result.push(`${domain}=${ipsStr}`);
      } else {
        result.push(`${domain}=${value}`);
      }
    },
  );

  return result.join(", ");
}

function parseHosts(str: string): NameserverPolicy {
  const result: NameserverPolicy = {};
  if (!str) return result;

  str.split(",").forEach((item) => {
    const parts = item.trim().split("=");
    if (parts.length < 2) return;

    const domain = parts[0].trim();
    const valueStr = parts.slice(1).join("=").trim();

    if (valueStr.includes(";")) {
      result[domain] = valueStr
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      result[domain] = valueStr;
    }
  });

  return result;
}

function parseList(str: string): string[] {
  if (!str?.trim()) return [];
  return str
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// 默认DNS配置
const DEFAULT_DNS_CONFIG = {
  enable: true,
  listen: ":53",
  "enhanced-mode": "fake-ip" as "fake-ip" | "redir-host",
  "fake-ip-range": "198.18.0.1/16",
  "fake-ip-filter-mode": "blacklist" as "blacklist" | "whitelist",
  "prefer-h3": false,
  "respect-rules": false,
  "use-hosts": false,
  "use-system-hosts": false,
  ipv6: true,
  "fake-ip-filter": [
    "*.lan",
    "*.local",
    "*.arpa",
    "time.*.com",
    "ntp.*.com",
    "time.*.com",
    "+.market.xiaomi.com",
    "localhost.ptlogin2.qq.com",
    "*.msftncsi.com",
    "www.msftconnecttest.com",
  ],
  "default-nameserver": [
    "system",
    "223.6.6.6",
    "8.8.8.8",
    "2400:3200::1",
    "2001:4860:4860::8888",
  ],
  nameserver: [
    "8.8.8.8",
    "https://doh.pub/dns-query",
    "https://dns.alidns.com/dns-query",
  ],
  fallback: [],
  "nameserver-policy": {},
  "proxy-server-nameserver": [
    "https://doh.pub/dns-query",
    "https://dns.alidns.com/dns-query",
    "tls://223.5.5.5",
  ],
  "direct-nameserver": [],
  "direct-nameserver-follow-policy": false,
  "fallback-filter": {
    geoip: true,
    "geoip-code": "CN",
    ipcidr: ["240.0.0.0/4", "0.0.0.0/32"],
    domain: ["+.google.com", "+.facebook.com", "+.youtube.com"],
  },
};

export function DnsViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();
  const { clash, mutateClash } = useClash();
  const themeMode = useThemeMode();

  const [open, setOpen] = useState(false);
  const [visualization, setVisualization] = useState(true);
  const skipYamlSyncRef = useRef(false);
  const [values, setValues] = useState<{
    enable: boolean;
    listen: string;
    enhancedMode: "fake-ip" | "redir-host";
    fakeIpRange: string;
    fakeIpFilterMode: "blacklist" | "whitelist";
    preferH3: boolean;
    respectRules: boolean;
    useHosts: boolean;
    useSystemHosts: boolean;
    ipv6: boolean;
    fakeIpFilter: string;
    nameserver: string;
    fallback: string;
    defaultNameserver: string;
    proxyServerNameserver: string;
    directNameserver: string;
    directNameserverFollowPolicy: boolean;
    fallbackGeoip: boolean;
    fallbackGeoipCode: string;
    fallbackIpcidr: string;
    fallbackDomain: string;
    nameserverPolicy: string;
    hosts: string; // hosts设置，独立于dns
  }>({
    enable: DEFAULT_DNS_CONFIG.enable,
    listen: DEFAULT_DNS_CONFIG.listen,
    enhancedMode: DEFAULT_DNS_CONFIG["enhanced-mode"],
    fakeIpRange: DEFAULT_DNS_CONFIG["fake-ip-range"],
    fakeIpFilterMode: DEFAULT_DNS_CONFIG["fake-ip-filter-mode"],
    preferH3: DEFAULT_DNS_CONFIG["prefer-h3"],
    respectRules: DEFAULT_DNS_CONFIG["respect-rules"],
    useHosts: DEFAULT_DNS_CONFIG["use-hosts"],
    useSystemHosts: DEFAULT_DNS_CONFIG["use-system-hosts"],
    ipv6: DEFAULT_DNS_CONFIG.ipv6,
    fakeIpFilter: DEFAULT_DNS_CONFIG["fake-ip-filter"].join(", "),
    defaultNameserver: DEFAULT_DNS_CONFIG["default-nameserver"].join(", "),
    nameserver: DEFAULT_DNS_CONFIG.nameserver.join(", "),
    fallback: DEFAULT_DNS_CONFIG.fallback.join(", "),
    proxyServerNameserver:
      DEFAULT_DNS_CONFIG["proxy-server-nameserver"]?.join(", ") || "",
    directNameserver: DEFAULT_DNS_CONFIG["direct-nameserver"]?.join(", ") || "",
    directNameserverFollowPolicy:
      DEFAULT_DNS_CONFIG["direct-nameserver-follow-policy"] || false,
    fallbackGeoip: DEFAULT_DNS_CONFIG["fallback-filter"].geoip,
    fallbackGeoipCode: DEFAULT_DNS_CONFIG["fallback-filter"]["geoip-code"],
    fallbackIpcidr:
      DEFAULT_DNS_CONFIG["fallback-filter"].ipcidr?.join(", ") || "",
    fallbackDomain:
      DEFAULT_DNS_CONFIG["fallback-filter"].domain?.join(", ") || "",
    nameserverPolicy: "",
    hosts: "",
  });

  // 用于YAML编辑模式
  const [yamlContent, setYamlContent] = useReducer(
    (_: string, next: string) => next,
    "",
  );

  // 从配置对象更新表单值
  const updateValuesFromConfig = useCallback(
    (config: any) => {
      if (!config) return;

      const dnsConfig = config.dns || {};
      const hostsConfig = config.hosts || {};

      const enhancedMode =
        dnsConfig["enhanced-mode"] || DEFAULT_DNS_CONFIG["enhanced-mode"];
      const validEnhancedMode =
        enhancedMode === "fake-ip" || enhancedMode === "redir-host"
          ? enhancedMode
          : DEFAULT_DNS_CONFIG["enhanced-mode"];

      const fakeIpFilterMode =
        dnsConfig["fake-ip-filter-mode"] ||
        DEFAULT_DNS_CONFIG["fake-ip-filter-mode"];
      const validFakeIpFilterMode =
        fakeIpFilterMode === "blacklist" || fakeIpFilterMode === "whitelist"
          ? fakeIpFilterMode
          : DEFAULT_DNS_CONFIG["fake-ip-filter-mode"];

      setValues({
        enable: dnsConfig.enable ?? DEFAULT_DNS_CONFIG.enable,
        listen: dnsConfig.listen ?? DEFAULT_DNS_CONFIG.listen,
        enhancedMode: validEnhancedMode,
        fakeIpRange:
          dnsConfig["fake-ip-range"] ?? DEFAULT_DNS_CONFIG["fake-ip-range"],
        fakeIpFilterMode: validFakeIpFilterMode,
        preferH3: dnsConfig["prefer-h3"] ?? DEFAULT_DNS_CONFIG["prefer-h3"],
        respectRules:
          dnsConfig["respect-rules"] ?? DEFAULT_DNS_CONFIG["respect-rules"],
        useHosts: dnsConfig["use-hosts"] ?? DEFAULT_DNS_CONFIG["use-hosts"],
        useSystemHosts:
          dnsConfig["use-system-hosts"] ??
          DEFAULT_DNS_CONFIG["use-system-hosts"],
        ipv6: dnsConfig.ipv6 ?? DEFAULT_DNS_CONFIG.ipv6,
        fakeIpFilter:
          dnsConfig["fake-ip-filter"]?.join(", ") ??
          DEFAULT_DNS_CONFIG["fake-ip-filter"].join(", "),
        nameserver:
          dnsConfig.nameserver?.join(", ") ??
          DEFAULT_DNS_CONFIG.nameserver.join(", "),
        fallback:
          dnsConfig.fallback?.join(", ") ??
          DEFAULT_DNS_CONFIG.fallback.join(", "),
        defaultNameserver:
          dnsConfig["default-nameserver"]?.join(", ") ??
          DEFAULT_DNS_CONFIG["default-nameserver"].join(", "),
        proxyServerNameserver:
          dnsConfig["proxy-server-nameserver"]?.join(", ") ??
          (DEFAULT_DNS_CONFIG["proxy-server-nameserver"]?.join(", ") || ""),
        directNameserver:
          dnsConfig["direct-nameserver"]?.join(", ") ??
          (DEFAULT_DNS_CONFIG["direct-nameserver"]?.join(", ") || ""),
        directNameserverFollowPolicy:
          dnsConfig["direct-nameserver-follow-policy"] ??
          DEFAULT_DNS_CONFIG["direct-nameserver-follow-policy"],
        fallbackGeoip:
          dnsConfig["fallback-filter"]?.geoip ??
          DEFAULT_DNS_CONFIG["fallback-filter"].geoip,
        fallbackGeoipCode:
          dnsConfig["fallback-filter"]?.["geoip-code"] ??
          DEFAULT_DNS_CONFIG["fallback-filter"]["geoip-code"],
        fallbackIpcidr:
          dnsConfig["fallback-filter"]?.ipcidr?.join(", ") ??
          DEFAULT_DNS_CONFIG["fallback-filter"].ipcidr.join(", "),
        fallbackDomain:
          dnsConfig["fallback-filter"]?.domain?.join(", ") ??
          DEFAULT_DNS_CONFIG["fallback-filter"].domain.join(", "),
        nameserverPolicy:
          formatNameserverPolicy(dnsConfig["nameserver-policy"]) || "",
        hosts: formatHosts(hostsConfig) || "",
      });
    },
    [setValues],
  );

  const generateDnsConfig = useCallback(() => {
    const dnsConfig: any = {
      enable: values.enable,
      listen: values.listen,
      "enhanced-mode": values.enhancedMode,
      "fake-ip-range": values.fakeIpRange,
      "fake-ip-filter-mode": values.fakeIpFilterMode,
      "prefer-h3": values.preferH3,
      "respect-rules": values.respectRules,
      "use-hosts": values.useHosts,
      "use-system-hosts": values.useSystemHosts,
      ipv6: values.ipv6,
      "fake-ip-filter": parseList(values.fakeIpFilter),
      "default-nameserver": parseList(values.defaultNameserver),
      nameserver: parseList(values.nameserver),
      "direct-nameserver-follow-policy": values.directNameserverFollowPolicy,
      "fallback-filter": {
        geoip: values.fallbackGeoip,
        "geoip-code": values.fallbackGeoipCode,
        ipcidr: parseList(values.fallbackIpcidr),
        domain: parseList(values.fallbackDomain),
      },

      fallback: parseList(values.fallback),
      "proxy-server-nameserver": parseList(values.proxyServerNameserver),
      "direct-nameserver": parseList(values.directNameserver),
    };

    const policy = parseNameserverPolicy(values.nameserverPolicy);
    if (Object.keys(policy).length > 0) {
      dnsConfig["nameserver-policy"] = policy;
    }

    return dnsConfig;
  }, [values]);

  const updateYamlFromValues = useCallback(() => {
    const config: Record<string, any> = {};

    const dnsConfig = generateDnsConfig();
    if (Object.keys(dnsConfig).length > 0) {
      config.dns = dnsConfig;
    }

    const hosts = parseHosts(values.hosts);
    if (Object.keys(hosts).length > 0) {
      config.hosts = hosts;
    }

    setYamlContent(yaml.dump(config, { forceQuotes: true }));
  }, [generateDnsConfig, setYamlContent, values.hosts]);

  // 重置为默认值
  const resetToDefaults = useCallback(() => {
    setValues({
      enable: DEFAULT_DNS_CONFIG.enable,
      listen: DEFAULT_DNS_CONFIG.listen,
      enhancedMode: DEFAULT_DNS_CONFIG["enhanced-mode"],
      fakeIpRange: DEFAULT_DNS_CONFIG["fake-ip-range"],
      fakeIpFilterMode: DEFAULT_DNS_CONFIG["fake-ip-filter-mode"],
      preferH3: DEFAULT_DNS_CONFIG["prefer-h3"],
      respectRules: DEFAULT_DNS_CONFIG["respect-rules"],
      useHosts: DEFAULT_DNS_CONFIG["use-hosts"],
      useSystemHosts: DEFAULT_DNS_CONFIG["use-system-hosts"],
      ipv6: DEFAULT_DNS_CONFIG.ipv6,
      fakeIpFilter: DEFAULT_DNS_CONFIG["fake-ip-filter"].join(", "),
      defaultNameserver: DEFAULT_DNS_CONFIG["default-nameserver"].join(", "),
      nameserver: DEFAULT_DNS_CONFIG.nameserver.join(", "),
      fallback: DEFAULT_DNS_CONFIG.fallback.join(", "),
      proxyServerNameserver:
        DEFAULT_DNS_CONFIG["proxy-server-nameserver"]?.join(", ") || "",
      directNameserver:
        DEFAULT_DNS_CONFIG["direct-nameserver"]?.join(", ") || "",
      directNameserverFollowPolicy:
        DEFAULT_DNS_CONFIG["direct-nameserver-follow-policy"] || false,
      fallbackGeoip: DEFAULT_DNS_CONFIG["fallback-filter"].geoip,
      fallbackGeoipCode: DEFAULT_DNS_CONFIG["fallback-filter"]["geoip-code"],
      fallbackIpcidr:
        DEFAULT_DNS_CONFIG["fallback-filter"].ipcidr?.join(", ") || "",
      fallbackDomain:
        DEFAULT_DNS_CONFIG["fallback-filter"].domain?.join(", ") || "",
      nameserverPolicy: "",
      hosts: "",
    });

    updateYamlFromValues();
  }, [setValues, updateYamlFromValues]);

  // 从YAML更新表单值
  const updateValuesFromYaml = useCallback(() => {
    try {
      const parsedYaml = yaml.load(yamlContent) as any;
      if (!parsedYaml) return;

      skipYamlSyncRef.current = true;
      updateValuesFromConfig(parsedYaml);
    } catch {
      showNotice.error("settings.modals.dns.errors.invalidYaml");
    }
  }, [yamlContent, updateValuesFromConfig]);

  useEffect(() => {
    if (skipYamlSyncRef.current) {
      skipYamlSyncRef.current = false;
      return;
    }
    updateYamlFromValues();
  }, [updateYamlFromValues]);

  const latestUpdateValuesFromYamlRef = useRef(updateValuesFromYaml);
  const latestUpdateYamlFromValuesRef = useRef(updateYamlFromValues);

  useEffect(() => {
    latestUpdateValuesFromYamlRef.current = updateValuesFromYaml;
    latestUpdateYamlFromValuesRef.current = updateYamlFromValues;
  }, [updateValuesFromYaml, updateYamlFromValues]);

  useEffect(() => {
    if (visualization) {
      latestUpdateValuesFromYamlRef.current();
    } else {
      latestUpdateYamlFromValuesRef.current();
    }
  }, [visualization]);

  const initDnsConfig = useCallback(async () => {
    try {
      const dnsConfigExists = await invoke<boolean>(
        "check_dns_config_exists",
        {},
      );

      if (dnsConfigExists) {
        const dnsConfig = await invoke<string>("get_dns_config_content", {});
        const config = yaml.load(dnsConfig) as any;

        updateValuesFromConfig(config);
        setYamlContent(dnsConfig);
      } else {
        resetToDefaults();
      }
    } catch (err) {
      console.error("Failed to initialize DNS config", err);
      resetToDefaults();
    }
  }, [resetToDefaults, setYamlContent, updateValuesFromConfig]);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setOpen(true);
        void initDnsConfig();
      },
      close: () => setOpen(false),
    }),
    [initDnsConfig],
  );

  // 生成DNS配置对象
  // 处理保存操作
  const onSave = useLockFn(async () => {
    try {
      let config: Record<string, any>;

      if (visualization) {
        // 使用表单值生成配置
        config = {};

        const dnsConfig = generateDnsConfig();
        if (Object.keys(dnsConfig).length > 0) {
          config.dns = dnsConfig;
        }

        const hosts = parseHosts(values.hosts);
        if (Object.keys(hosts).length > 0) {
          config.hosts = hosts;
        }
      } else {
        // 使用YAML编辑器的值
        const parsedConfig = yaml.load(yamlContent);
        if (typeof parsedConfig !== "object" || parsedConfig === null) {
          throw new Error(t("settings.modals.dns.errors.invalid"));
        }
        config = parsedConfig as Record<string, any>;
      }

      // 保存配置
      await invoke("save_dns_config", { dnsConfig: config });

      // 验证配置
      const [isValid, errorMsg] = await invoke<[boolean, string]>(
        "validate_dns_config",
        {},
      );

      if (!isValid) {
        let cleanErrorMsg = errorMsg;

        // 提取关键错误信息
        if (errorMsg.includes("level=error")) {
          const errorLines = errorMsg
            .split("\n")
            .filter(
              (line) =>
                line.includes("level=error") ||
                line.includes("level=fatal") ||
                line.includes("failed"),
            );

          if (errorLines.length > 0) {
            cleanErrorMsg = errorLines
              .map((line) => {
                const msgMatch = line.match(/msg="([^"]+)"/);
                return msgMatch ? msgMatch[1] : line;
              })
              .join(", ");
          }
        }

        showNotice.error(
          "settings.modals.dns.messages.configError",
          cleanErrorMsg,
        );
        return;
      }

      // 如果DNS开关当前是打开的，则需要应用新的DNS配置
      if (clash?.dns?.enable) {
        await invoke("apply_dns_config", { apply: true });
        mutateClash();
      }

      setOpen(false);
      showNotice.success("settings.modals.dns.messages.saved");
    } catch (err) {
      showNotice.error(err);
    }
  });

  // YAML编辑器内容变更处理
  const handleYamlChange = (value?: string) => {
    setYamlContent(value || "");

    // 允许YAML编辑后立即分析和更新表单值
    try {
      const config = yaml.load(value || "") as any;
      if (config && typeof config === "object") {
        setTimeout(() => {
          updateValuesFromConfig(config);
        }, 300);
      }
    } catch (err) {
      debugLog("YAML解析错误，忽略自动更新", err);
    }
  };

  // 处理表单值变化
  const handleChange = (field: string) => (event: any) => {
    const value =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;

    setValues((prev) => {
      const newValues = {
        ...prev,
        [field]: value,
      };

      // 当可视化编辑模式下的值变化时，自动更新YAML
      if (visualization) {
        setTimeout(() => {
          updateYamlFromValues();
        }, 0);
      }

      return newValues;
    });
  };

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between" alignItems="center">
          {t("settings.modals.dns.dialog.title")}
          <Box display="flex" alignItems="center" gap={1}>
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<RestartAltRounded />}
              onClick={resetToDefaults}
            >
              {t("shared.actions.resetToDefault")}
            </Button>
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
      contentSx={{
        width: 550,
        overflow: "auto",
        ...(visualization
          ? {}
          : { padding: "0 24px", display: "flex", flexDirection: "column" }),
      }}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      {/* Warning message */}
      <Typography
        variant="body2"
        color="warning.main"
        sx={{ mb: 2, mt: 0, fontStyle: "italic" }}
      >
        {t("settings.modals.dns.dialog.warning")}
      </Typography>

      {visualization ? (
        <List>
          <Typography
            variant="subtitle1"
            sx={{ mt: 1, mb: 1, fontWeight: "bold" }}
          >
            {t("settings.modals.dns.sections.general")}
          </Typography>

          <Item>
            <ListItemText primary={t("settings.modals.dns.fields.enable")} />
            <Switch
              edge="end"
              checked={values.enable}
              onChange={handleChange("enable")}
            />
          </Item>

          <Item>
            <ListItemText primary={t("settings.modals.dns.fields.listen")} />
            <TextField
              size="small"
              autoComplete="off"
              value={values.listen}
              onChange={handleChange("listen")}
              placeholder=":53"
              sx={{ width: 150 }}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.enhancedMode")}
            />
            <FormControl size="small" sx={{ width: 150 }}>
              <Select
                value={values.enhancedMode}
                onChange={handleChange("enhancedMode")}
              >
                <MenuItem value="fake-ip">fake-ip</MenuItem>
                <MenuItem value="redir-host">redir-host</MenuItem>
              </Select>
            </FormControl>
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.fakeIpRange")}
            />
            <TextField
              size="small"
              autoComplete="off"
              value={values.fakeIpRange}
              onChange={handleChange("fakeIpRange")}
              placeholder="198.18.0.1/16"
              sx={{ width: 150 }}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.fakeIpFilterMode")}
            />
            <FormControl size="small" sx={{ width: 150 }}>
              <Select
                value={values.fakeIpFilterMode}
                onChange={handleChange("fakeIpFilterMode")}
              >
                <MenuItem value="blacklist">blacklist</MenuItem>
                <MenuItem value="whitelist">whitelist</MenuItem>
              </Select>
            </FormControl>
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.ipv6.label")}
              secondary={t("settings.modals.dns.fields.ipv6.description")}
            />
            <Switch
              edge="end"
              checked={values.ipv6}
              onChange={handleChange("ipv6")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.preferH3.label")}
              secondary={t("settings.modals.dns.fields.preferH3.description")}
            />
            <Switch
              edge="end"
              checked={values.preferH3}
              onChange={handleChange("preferH3")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.respectRules.label")}
              secondary={t(
                "settings.modals.dns.fields.respectRules.description",
              )}
            />
            <Switch
              edge="end"
              checked={values.respectRules}
              onChange={handleChange("respectRules")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.useHosts.label")}
              secondary={t("settings.modals.dns.fields.useHosts.description")}
            />
            <Switch
              edge="end"
              checked={values.useHosts}
              onChange={handleChange("useHosts")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.useSystemHosts.label")}
              secondary={t(
                "settings.modals.dns.fields.useSystemHosts.description",
              )}
            />
            <Switch
              edge="end"
              checked={values.useSystemHosts}
              onChange={handleChange("useSystemHosts")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.directPolicy.label")}
              secondary={t(
                "settings.modals.dns.fields.directPolicy.description",
              )}
            />
            <Switch
              edge="end"
              checked={values.directNameserverFollowPolicy}
              onChange={handleChange("directNameserverFollowPolicy")}
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.defaultNameserver.label")}
              secondary={t(
                "settings.modals.dns.fields.defaultNameserver.description",
              )}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={3}
              size="small"
              value={values.defaultNameserver}
              onChange={handleChange("defaultNameserver")}
              placeholder="system,223.6.6.6, 8.8.8.8, 2400:3200::1, 2001:4860:4860::8888"
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.nameserver.label")}
              secondary={t("settings.modals.dns.fields.nameserver.description")}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              size="small"
              value={values.nameserver}
              onChange={handleChange("nameserver")}
              placeholder="8.8.8.8, https://doh.pub/dns-query, https://dns.alidns.com/dns-query"
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.fallback.label")}
              secondary={t("settings.modals.dns.fields.fallback.description")}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              size="small"
              value={values.fallback}
              onChange={handleChange("fallback")}
              placeholder="https://dns.alidns.com/dns-query, https://dns.google/dns-query, https://cloudflare-dns.com/dns-query"
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.proxy.label")}
              secondary={t("settings.modals.dns.fields.proxy.description")}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={3}
              size="small"
              value={values.proxyServerNameserver}
              onChange={handleChange("proxyServerNameserver")}
              placeholder="https://doh.pub/dns-query, https://dns.alidns.com/dns-query"
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.directNameserver.label")}
              secondary={t(
                "settings.modals.dns.fields.directNameserver.description",
              )}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={3}
              size="small"
              value={values.directNameserver}
              onChange={handleChange("directNameserver")}
              placeholder="system, 223.6.6.6"
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.fakeIpFilter.label")}
              secondary={t(
                "settings.modals.dns.fields.fakeIpFilter.description",
              )}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              size="small"
              value={values.fakeIpFilter}
              onChange={handleChange("fakeIpFilter")}
              placeholder="*.lan, *.local, localhost.ptlogin2.qq.com"
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.nameserverPolicy.label")}
              secondary={t(
                "settings.modals.dns.fields.nameserverPolicy.description",
              )}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              size="small"
              value={values.nameserverPolicy}
              onChange={handleChange("nameserverPolicy")}
              placeholder="+.arpa=10.0.0.1, rule-set:cn=https://doh.pub/dns-query;https://dns.alidns.com/dns-query"
            />
          </Item>

          <Typography
            variant="subtitle2"
            sx={{ mt: 2, mb: 1, fontWeight: "bold" }}
          >
            {t("settings.modals.dns.sections.fallbackFilter")}
          </Typography>

          <Item>
            <ListItemText
              primary={t("settings.modals.dns.fields.geoipFiltering.label")}
              secondary={t(
                "settings.modals.dns.fields.geoipFiltering.description",
              )}
            />
            <Switch
              edge="end"
              checked={values.fallbackGeoip}
              onChange={handleChange("fallbackGeoip")}
            />
          </Item>

          <Item>
            <ListItemText primary={t("settings.modals.dns.fields.geoipCode")} />
            <TextField
              size="small"
              autoComplete="off"
              value={values.fallbackGeoipCode}
              onChange={handleChange("fallbackGeoipCode")}
              placeholder="CN"
              sx={{ width: 100 }}
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.fallbackIpCidr.label")}
              secondary={t(
                "settings.modals.dns.fields.fallbackIpCidr.description",
              )}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={3}
              size="small"
              value={values.fallbackIpcidr}
              onChange={handleChange("fallbackIpcidr")}
              placeholder="240.0.0.0/4, 127.0.0.1/8"
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.fallbackDomain.label")}
              secondary={t(
                "settings.modals.dns.fields.fallbackDomain.description",
              )}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={3}
              size="small"
              value={values.fallbackDomain}
              onChange={handleChange("fallbackDomain")}
              placeholder="+.google.com, +.facebook.com, +.youtube.com"
            />
          </Item>

          {/* Hosts 配置部分 */}
          <Typography
            variant="subtitle1"
            sx={{ mt: 3, mb: 0, fontWeight: "bold" }}
          >
            {t("settings.modals.dns.sections.hosts")}
          </Typography>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("settings.modals.dns.fields.hosts.label")}
              secondary={t("settings.modals.dns.fields.hosts.description")}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              size="small"
              value={values.hosts}
              onChange={handleChange("hosts")}
              placeholder="*.clash.dev=127.0.0.1, alpha.clash.dev=::1, test.com=1.1.1.1;2.2.2.2, baidu.com=google.com"
            />
          </Item>
        </List>
      ) : (
        <MonacoEditor
          height="100vh"
          language="yaml"
          value={yamlContent}
          theme={themeMode === "light" ? "light" : "vs-dark"}
          className="flex-grow"
          options={{
            tabSize: 2,
            minimap: {
              enabled: document.documentElement.clientWidth >= 1500,
            },
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
            fontLigatures: false,
            smoothScrolling: true,
          }}
          onChange={handleYamlChange}
        />
      )}
    </BaseDialog>
  );
}
