import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
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
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { RestartAltRounded } from "@mui/icons-material";
import { useClash } from "@/hooks/use-clash";
import { BaseDialog, DialogRef } from "@/components/base";
import yaml from "js-yaml";
import MonacoEditor from "react-monaco-editor";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";
import { invoke } from "@tauri-apps/api/core";
import { showNotice } from "@/services/noticeService";

const Item = styled(ListItem)(({ theme }) => ({
  padding: "8px 0",
  borderBottom: `1px solid ${theme.palette.divider}`,
  "& textarea": {
    lineHeight: 1.5,
    fontSize: 14,
    resize: "vertical",
  },
}));

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

export const DnsViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { clash, mutateClash, patchClash } = useClash();
  const themeMode = useThemeMode();

  const [open, setOpen] = useState(false);
  const [visualization, setVisualization] = useState(true);
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
  const [yamlContent, setYamlContent] = useState("");

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      // 获取DNS配置文件并初始化表单
      initDnsConfig();
    },
    close: () => setOpen(false),
  }));

  // 初始化DNS配置
  const initDnsConfig = async () => {
    try {
      // 尝试从dns_config.yaml文件读取配置
      const dnsConfigExists = await invoke<boolean>(
        "check_dns_config_exists",
        {},
      );

      if (dnsConfigExists) {
        // 如果存在配置文件，加载其内容
        const dnsConfig = await invoke<string>("get_dns_config_content", {});
        const config = yaml.load(dnsConfig) as any;

        // 更新表单数据
        updateValuesFromConfig(config);
        // 更新YAML编辑器内容
        setYamlContent(dnsConfig);
      } else {
        // 如果不存在配置文件，使用默认值
        resetToDefaults();
      }
    } catch (err) {
      console.error("Failed to initialize DNS config", err);
      resetToDefaults();
    }
  };

  // 从配置对象更新表单值
  const updateValuesFromConfig = (config: any) => {
    if (!config) return;

    // 提取dns配置
    const dnsConfig = config.dns || {};
    // 提取hosts配置（与dns同级）
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
        dnsConfig["use-system-hosts"] ?? DEFAULT_DNS_CONFIG["use-system-hosts"],
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
  };

  // 重置为默认值
  const resetToDefaults = () => {
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

    // 更新YAML编辑器内容
    updateYamlFromValues();
  };

  // 从表单值更新YAML内容
  const updateYamlFromValues = () => {
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
  };

  // 从YAML更新表单值
  const updateValuesFromYaml = () => {
    try {
      const parsedYaml = yaml.load(yamlContent) as any;
      if (!parsedYaml) return;

      updateValuesFromConfig(parsedYaml);
    } catch (err: any) {
      showNotice("error", t("Invalid YAML format"));
    }
  };

  // 格式化nameserver-policy为字符串
  const formatNameserverPolicy = (policy: any): string => {
    if (!policy) return "";

    let result: string[] = [];

    Object.entries(policy).forEach(([domain, servers]) => {
      if (Array.isArray(servers)) {
        // 处理数组格式的服务器
        const serversStr = servers.join(";");
        result.push(`${domain}=${serversStr}`);
      } else {
        // 处理单个服务器
        result.push(`${domain}=${servers}`);
      }
    });

    return result.join(", ");
  };

  // 解析nameserver-policy为对象
  const parseNameserverPolicy = (str: string): Record<string, any> => {
    const result: Record<string, any> = {};
    if (!str) return result;

    str.split(",").forEach((item) => {
      const parts = item.trim().split("=");
      if (parts.length < 2) return;

      const domain = parts[0].trim();
      const serversStr = parts.slice(1).join("=").trim();

      // 检查是否包含多个分号分隔的服务器
      if (serversStr.includes(";")) {
        // 多个服务器，作为数组处理
        result[domain] = serversStr
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        // 单个服务器
        result[domain] = serversStr;
      }
    });

    return result;
  };

  // 格式化hosts为字符串
  const formatHosts = (hosts: any): string => {
    if (!hosts || typeof hosts !== "object") return "";

    let result: string[] = [];

    Object.entries(hosts).forEach(([domain, value]) => {
      if (Array.isArray(value)) {
        // 处理数组格式的IP
        const ipsStr = value.join(";");
        result.push(`${domain}=${ipsStr}`);
      } else {
        // 处理单个IP或域名
        result.push(`${domain}=${value}`);
      }
    });

    return result.join(", ");
  };

  // 解析hosts字符串为对象
  const parseHosts = (str: string): Record<string, any> => {
    const result: Record<string, any> = {};
    if (!str) return result;

    str.split(",").forEach((item) => {
      const parts = item.trim().split("=");
      if (parts.length < 2) return;

      const domain = parts[0].trim();
      const valueStr = parts.slice(1).join("=").trim();

      // 检查是否包含多个分号分隔的IP
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
  };

  // 初始化时设置默认YAML
  useEffect(() => {
    updateYamlFromValues();
  }, []);

  // 切换编辑模式时的处理
  useEffect(() => {
    if (visualization) {
      updateValuesFromYaml();
    } else {
      updateYamlFromValues();
    }
  }, [visualization]);

  // 解析列表字符串为数组
  const parseList = (str: string): string[] => {
    if (!str) return [];
    return str
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  // 生成DNS配置对象
  const generateDnsConfig = () => {
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
    };

    // 只在有值时添加其他可选字段
    if (values.fallback) {
      dnsConfig["fallback"] = parseList(values.fallback);
    }

    const policy = parseNameserverPolicy(values.nameserverPolicy);
    if (Object.keys(policy).length > 0) {
      dnsConfig["nameserver-policy"] = policy;
    }

    if (values.proxyServerNameserver) {
      dnsConfig["proxy-server-nameserver"] = parseList(
        values.proxyServerNameserver,
      );
    }

    if (values.directNameserver) {
      dnsConfig["direct-nameserver"] = parseList(values.directNameserver);
    }

    return dnsConfig;
  };

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
          throw new Error(t("Invalid configuration"));
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

        showNotice(
          "error",
          t("DNS configuration error") + ": " + cleanErrorMsg,
        );
        return;
      }

      // 如果DNS开关当前是打开的，则需要应用新的DNS配置
      if (clash?.dns?.enable) {
        await invoke("apply_dns_config", { apply: true });
        mutateClash();
      }

      setOpen(false);
      showNotice("success", t("DNS settings saved"));
    } catch (err: any) {
      showNotice("error", err.message || err.toString());
    }
  });

  // YAML编辑器内容变更处理
  const handleYamlChange = (value: string) => {
    setYamlContent(value || "");

    // 允许YAML编辑后立即分析和更新表单值
    try {
      const config = yaml.load(value) as any;
      if (config && typeof config === "object") {
        setTimeout(() => {
          updateValuesFromConfig(config);
        }, 300);
      }
    } catch (err) {
      console.log("YAML解析错误，忽略自动更新", err);
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
          {t("DNS Overwrite")}
          <Box display="flex" alignItems="center" gap={1}>
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<RestartAltRounded />}
              onClick={resetToDefaults}
            >
              {t("Reset to Default")}
            </Button>
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
      contentSx={{
        width: 550,
        overflow: "auto",
        ...(visualization
          ? {}
          : { padding: "0 24px", display: "flex", flexDirection: "column" }),
      }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
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
        {t("DNS Settings Warning")}
      </Typography>

      {visualization ? (
        <List>
          <Typography
            variant="subtitle1"
            sx={{ mt: 1, mb: 1, fontWeight: "bold" }}
          >
            {t("DNS Settings")}
          </Typography>

          <Item>
            <ListItemText primary={t("Enable DNS")} />
            <Switch
              edge="end"
              checked={values.enable}
              onChange={handleChange("enable")}
            />
          </Item>

          <Item>
            <ListItemText primary={t("DNS Listen")} />
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
            <ListItemText primary={t("Enhanced Mode")} />
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
            <ListItemText primary={t("Fake IP Range")} />
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
            <ListItemText primary={t("Fake IP Filter Mode")} />
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
              primary={t("IPv6")}
              secondary={t("Enable IPv6 DNS resolution")}
            />
            <Switch
              edge="end"
              checked={values.ipv6}
              onChange={handleChange("ipv6")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("Prefer H3")}
              secondary={t("DNS DOH使用HTTP/3")}
            />
            <Switch
              edge="end"
              checked={values.preferH3}
              onChange={handleChange("preferH3")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("Respect Rules")}
              secondary={t("DNS connections follow routing rules")}
            />
            <Switch
              edge="end"
              checked={values.respectRules}
              onChange={handleChange("respectRules")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("Use Hosts")}
              secondary={t("Enable to resolve hosts through hosts file")}
            />
            <Switch
              edge="end"
              checked={values.useHosts}
              onChange={handleChange("useHosts")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("Use System Hosts")}
              secondary={t("Enable to resolve hosts through system hosts file")}
            />
            <Switch
              edge="end"
              checked={values.useSystemHosts}
              onChange={handleChange("useSystemHosts")}
            />
          </Item>

          <Item>
            <ListItemText
              primary={t("Direct Nameserver Follow Policy")}
              secondary={t("Whether to follow nameserver policy")}
            />
            <Switch
              edge="end"
              checked={values.directNameserverFollowPolicy}
              onChange={handleChange("directNameserverFollowPolicy")}
            />
          </Item>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("Default Nameserver")}
              secondary={t("Default DNS servers used to resolve DNS servers")}
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
              primary={t("Nameserver")}
              secondary={t("List of DNS servers")}
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
              primary={t("Fallback")}
              secondary={t("List of fallback DNS servers")}
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
              primary={t("Proxy Server Nameserver")}
              secondary={t("Proxy Node Nameserver")}
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
              primary={t("Direct Nameserver")}
              secondary={t("Direct outbound Nameserver")}
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
              primary={t("Fake IP Filter")}
              secondary={t("Domains that skip fake IP resolution")}
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
              primary={t("Nameserver Policy")}
              secondary={t("Domain-specific DNS server")}
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
            {t("Fallback Filter Settings")}
          </Typography>

          <Item>
            <ListItemText
              primary={t("GeoIP Filtering")}
              secondary={t("Enable GeoIP filtering for fallback")}
            />
            <Switch
              edge="end"
              checked={values.fallbackGeoip}
              onChange={handleChange("fallbackGeoip")}
            />
          </Item>

          <Item>
            <ListItemText primary={t("GeoIP Code")} />
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
              primary={t("Fallback IP CIDR")}
              secondary={t("IP CIDRs not using fallback servers")}
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
              primary={t("Fallback Domain")}
              secondary={t("Domains using fallback servers")}
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
            {t("Hosts Settings")}
          </Typography>

          <Item sx={{ flexDirection: "column", alignItems: "flex-start" }}>
            <ListItemText
              primary={t("Hosts")}
              secondary={t("Custom domain to IP or domain mapping")}
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
          theme={themeMode === "light" ? "vs" : "vs-dark"}
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
});
