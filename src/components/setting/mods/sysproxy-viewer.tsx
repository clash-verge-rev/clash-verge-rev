import { EditRounded } from "@mui/icons-material";
import {
  Autocomplete,
  Button,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";

import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { BaseFieldset } from "@/components/base/base-fieldset";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { EditorViewer } from "@/components/profile/editor-viewer";
import {
  useClashConfig,
  useSystemProxyAddress,
  useSystemProxyData,
} from "@/hooks/use-clash-data";
import { useVerge } from "@/hooks/use-verge";
import {
  getAutotemProxy,
  getNetworkInterfacesInfo,
  getSystemHostname,
  getSystemProxy,
  patchVergeConfig,
} from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import { debugLog } from "@/utils/debug";
import getSystem from "@/utils/get-system";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const DEFAULT_PAC = `function FindProxyForURL(url, host) {
  return "PROXY %proxy_host%:%mixed-port%; SOCKS5 %proxy_host%:%mixed-port%; DIRECT;";
}`;

/** NO_PROXY validation */

// *., cdn*., *, etc.
const domain_subdomain_part = String.raw`(?:[a-z0-9\-\*]+\.|\*)*`;
// .*, .cn, .moe, .co*, *
const domain_tld_part = String.raw`(?:\w{2,64}\*?|\*)`;
// *epicgames*, *skk.moe, *.skk.moe, skk.*, sponsor.cdn.skk.moe, *.*, etc.
// also matches 192.168.*, 10.*, 127.0.0.*, etc. (partial ipv4)
const rDomainSimple = domain_subdomain_part + domain_tld_part;

const ipv4_part = String.raw`\d{1,3}`;

const ipv6_part = "(?:[a-fA-F0-9:])+";

const rLocal = `localhost|<local>|localdomain`;

const getValidReg = (isWindows: boolean) => {
  // 127.0.0.1 (full ipv4)
  const rIPv4Unix = String.raw`(?:${ipv4_part}\.){3}${ipv4_part}(?:\/\d{1,2})?`;
  const rIPv4Windows = String.raw`(?:${ipv4_part}\.){3}${ipv4_part}`;

  const rIPv6Unix = String.raw`(?:${ipv6_part}:+)+${ipv6_part}(?:\/\d{1,3})?`;
  const rIPv6Windows = String.raw`(?:${ipv6_part}:+)+${ipv6_part}`;

  const rValidPart = `${rDomainSimple}|${
    isWindows ? rIPv4Windows : rIPv4Unix
  }|${isWindows ? rIPv6Windows : rIPv6Unix}|${rLocal}`;
  const separator = isWindows ? ";" : ",";
  const rValid = String.raw`^(${rValidPart})(?:${separator}\s?(${rValidPart}))*${separator}?$`;

  return new RegExp(rValid);
};

export const SysproxyViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const isWindows = getSystem() === "windows";
  const validReg = useMemo(() => getValidReg(isWindows), [isWindows]);

  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { verge, patchVerge, mutateVerge } = useVerge();
  const [hostOptions, setHostOptions] = useState<string[]>([]);

  type AutoProxy = Awaited<ReturnType<typeof getAutotemProxy>>;
  const [autoproxy, setAutoproxy] = useState<AutoProxy>();

  const {
    enable_system_proxy: enabled,
    proxy_auto_config,
    pac_file_content,
    enable_proxy_guard,
    use_default_bypass,
    system_proxy_bypass,
    proxy_guard_duration,
    proxy_host,
  } = verge ?? {};

  const [value, setValue] = useState({
    guard: enable_proxy_guard,
    bypass: system_proxy_bypass,
    duration: proxy_guard_duration ?? 10,
    use_default: use_default_bypass ?? true,
    pac: proxy_auto_config,
    pac_content: pac_file_content ?? DEFAULT_PAC,
    proxy_host: proxy_host ?? "127.0.0.1",
  });

  const defaultBypass = () => {
    if (isWindows) {
      return "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
    }
    if (getSystem() === "linux") {
      return "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
    }
    return "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";
  };

  const { clashConfig } = useClashConfig();
  const { sysproxy, refreshSysproxy } = useSystemProxyData();

  const prevMixedPortRef = useRef(clashConfig?.mixedPort);

  useEffect(() => {
    const mixedPort = clashConfig?.mixedPort;
    if (!mixedPort || mixedPort === prevMixedPortRef.current) {
      return;
    }

    prevMixedPortRef.current = mixedPort;

    const updateProxy = async () => {
      try {
        const currentSysProxy = await getSystemProxy();
        const currentAutoProxy = await getAutotemProxy();

        if (value.pac ? currentAutoProxy?.enable : currentSysProxy?.enable) {
          await patchVergeConfig({ enable_system_proxy: false });
          await sleep(200);
          await patchVergeConfig({ enable_system_proxy: true });
          await Promise.all([
            mutate("getSystemProxy"),
            mutate("getAutotemProxy"),
          ]);
        }
      } catch (err) {
        showNotice.error(err);
      }
    };

    updateProxy();
  }, [clashConfig?.mixedPort, value.pac]);

  const systemProxyAddress = useSystemProxyAddress({
    clashConfig,
    sysproxy,
  });

  // 为当前状态计算系统代理地址
  const getSystemProxyAddress = useMemo(() => {
    if (!clashConfig) return "-";

    const isPacMode = value.pac ?? false;

    if (isPacMode) {
      const host = value.proxy_host || "127.0.0.1";
      const port = verge?.verge_mixed_port || clashConfig.mixedPort || 7897;
      return `${host}:${port}`;
    } else {
      return systemProxyAddress;
    }
  }, [
    value.pac,
    value.proxy_host,
    verge?.verge_mixed_port,
    clashConfig,
    systemProxyAddress,
  ]);
  const getCurrentPacUrl = useMemo(() => {
    const host = value.proxy_host || "127.0.0.1";
    // 根据环境判断PAC端口
    const port = import.meta.env.DEV ? 11233 : 33331;
    return `http://${host}:${port}/commands/pac`;
  }, [value.proxy_host]);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValue({
        guard: enable_proxy_guard,
        bypass: system_proxy_bypass,
        duration: proxy_guard_duration ?? 10,
        use_default: use_default_bypass ?? true,
        pac: proxy_auto_config,
        pac_content: pac_file_content ?? DEFAULT_PAC,
        proxy_host: proxy_host ?? "127.0.0.1",
      });
      void refreshSysproxy();
      getAutotemProxy().then((p) => setAutoproxy(p));
      fetchNetworkInterfaces();
    },
    close: () => setOpen(false),
  }));

  // 获取网络接口和主机名
  const fetchNetworkInterfaces = async () => {
    try {
      // 获取系统网络接口信息
      const interfaces = await getNetworkInterfacesInfo();
      const ipAddresses: string[] = [];

      // 从interfaces中提取IPv4和IPv6地址
      interfaces.forEach((iface) => {
        iface.addr.forEach((address) => {
          if (address.V4 && address.V4.ip) {
            ipAddresses.push(address.V4.ip);
          }
          if (address.V6 && address.V6.ip) {
            ipAddresses.push(address.V6.ip);
          }
        });
      });

      // 获取当前系统的主机名
      let hostname = "";
      try {
        hostname = await getSystemHostname();
        debugLog("获取到主机名:", hostname);
      } catch (err) {
        console.error("获取主机名失败:", err);
      }

      // 构建选项列表
      const options = ["127.0.0.1", "localhost"];

      // 确保主机名添加到列表，即使它是空字符串也记录下来
      if (hostname) {
        // 如果主机名不是localhost或127.0.0.1，则添加它
        if (hostname !== "localhost" && hostname !== "127.0.0.1") {
          hostname = hostname + ".local";
          options.push(hostname);
          debugLog("主机名已添加到选项中:", hostname);
        } else {
          debugLog("主机名与已有选项重复:", hostname);
        }
      } else {
        debugLog("主机名为空");
      }

      // 添加IP地址
      options.push(...ipAddresses);

      // 去重
      const uniqueOptions = Array.from(new Set(options));
      debugLog("最终选项列表:", uniqueOptions);
      setHostOptions(uniqueOptions);
    } catch (error) {
      console.error("获取网络接口失败:", error);
      // 失败时至少提供基本选项
      setHostOptions(["127.0.0.1", "localhost"]);
    }
  };

  const onSave = useLockFn(async () => {
    if (value.duration < 1) {
      showNotice.error("settings.modals.sysproxy.messages.durationTooShort");
      return;
    }
    if (value.bypass && !validReg.test(value.bypass)) {
      showNotice.error("settings.modals.sysproxy.messages.invalidBypass");
      return;
    }

    // 修改验证规则，允许IP和主机名
    const ipv4Regex =
      /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex =
      /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    const hostnameRegex =
      /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9])$/;

    if (
      !ipv4Regex.test(value.proxy_host) &&
      !ipv6Regex.test(value.proxy_host) &&
      !hostnameRegex.test(value.proxy_host)
    ) {
      showNotice.error("settings.modals.sysproxy.messages.invalidProxyHost");
      return;
    }

    setSaving(true);
    setOpen(false);
    setSaving(false);
    const patch: Partial<IVergeConfig> = {};

    if (value.guard !== enable_proxy_guard) {
      patch.enable_proxy_guard = value.guard;
    }
    if (value.duration !== proxy_guard_duration) {
      patch.proxy_guard_duration = value.duration;
    }
    if (value.bypass !== system_proxy_bypass) {
      patch.system_proxy_bypass = value.bypass;
    }
    if (value.pac !== proxy_auto_config) {
      patch.proxy_auto_config = value.pac;
    }
    if (value.use_default !== use_default_bypass) {
      patch.use_default_bypass = value.use_default;
    }

    let pacContent = value.pac_content;
    if (pacContent) {
      pacContent = pacContent.replace(/%proxy_host%/g, value.proxy_host);
      // 将 mixed-port 转换为字符串
      const mixedPortStr = (clashConfig?.mixedPort || "").toString();
      pacContent = pacContent.replace(/%mixed-port%/g, mixedPortStr);
    }

    if (pacContent !== pac_file_content) {
      patch.pac_file_content = pacContent;
    }

    // 处理IPv6地址，如果是IPv6地址但没有被方括号包围，则添加方括号
    let proxyHost = value.proxy_host;
    if (
      ipv6Regex.test(proxyHost) &&
      !proxyHost.startsWith("[") &&
      !proxyHost.endsWith("]")
    ) {
      proxyHost = `[${proxyHost}]`;
    }

    if (proxyHost !== proxy_host) {
      patch.proxy_host = proxyHost;
    }

    // 判断是否需要重置系统代理
    const needResetProxy =
      value.pac !== proxy_auto_config ||
      proxyHost !== proxy_host ||
      pacContent !== pac_file_content ||
      value.bypass !== system_proxy_bypass ||
      value.use_default !== use_default_bypass;

    Promise.resolve().then(async () => {
      try {
        // 乐观更新本地状态
        if (Object.keys(patch).length > 0) {
          mutateVerge({ ...verge, ...patch }, false);
        }
        if (Object.keys(patch).length > 0) {
          await patchVerge(patch);
        }
        setTimeout(async () => {
          try {
            await Promise.all([
              mutate("getSystemProxy"),
              mutate("getAutotemProxy"),
            ]);

            // 如果需要重置代理且代理当前启用
            if (needResetProxy && enabled) {
              const [currentSysProxy, currentAutoProxy] = await Promise.all([
                getSystemProxy(),
                getAutotemProxy(),
              ]);

              const isProxyActive = value.pac
                ? currentAutoProxy?.enable
                : currentSysProxy?.enable;

              if (isProxyActive) {
                await patchVergeConfig({ enable_system_proxy: false });
                await new Promise((resolve) => setTimeout(resolve, 50));
                await patchVergeConfig({ enable_system_proxy: true });
                await Promise.all([
                  mutate("getSystemProxy"),
                  mutate("getAutotemProxy"),
                ]);
              }
            }
          } catch (err) {
            console.warn("代理状态更新失败:", err);
          }
        }, 50);
      } catch (err) {
        console.error("配置保存失败:", err);
        mutateVerge();
        showNotice.error(err);
        // setOpen(true);
      }
    });
  });

  return (
    <BaseDialog
      open={open}
      title={t("settings.modals.sysproxy.title")}
      contentSx={{ width: 450, maxHeight: 565 }}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
      loading={saving}
      disableOk={saving}
    >
      <List>
        <BaseFieldset
          label={t("settings.modals.sysproxy.fieldsets.currentStatus")}
          padding="15px 10px"
        >
          <FlexBox>
            <Typography className="label">
              {t("settings.modals.sysproxy.fields.enableStatus")}
            </Typography>
            <Typography className="value">
              {value.pac
                ? autoproxy?.enable
                  ? t("shared.statuses.enabled")
                  : t("shared.statuses.disabled")
                : sysproxy?.enable
                  ? t("shared.statuses.enabled")
                  : t("shared.statuses.disabled")}
            </Typography>
          </FlexBox>
          {!value.pac && (
            <FlexBox>
              <Typography className="label">
                {t("settings.modals.sysproxy.fields.serverAddr")}
              </Typography>
              <Typography className="value">{getSystemProxyAddress}</Typography>
            </FlexBox>
          )}
          {value.pac && (
            <FlexBox>
              <Typography className="label">
                {t("settings.modals.sysproxy.fields.pacUrl")}
              </Typography>
              <Typography className="value">
                {getCurrentPacUrl || "-"}
              </Typography>
            </FlexBox>
          )}
        </BaseFieldset>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.sysproxy.fields.proxyHost")}
          />
          <Autocomplete
            size="small"
            sx={{ width: 150 }}
            options={hostOptions}
            value={value.proxy_host}
            freeSolo
            renderInput={(params) => (
              <TextField {...params} placeholder="127.0.0.1" size="small" />
            )}
            onChange={(_, newValue) => {
              setValue((v) => ({
                ...v,
                proxy_host: newValue || "127.0.0.1",
              }));
            }}
            onInputChange={(_, newInputValue) => {
              setValue((v) => ({
                ...v,
                proxy_host: newInputValue || "127.0.0.1",
              }));
            }}
          />
        </ListItem>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.sysproxy.fields.usePacMode")}
          />
          <Switch
            edge="end"
            disabled={!enabled}
            checked={value.pac}
            onChange={(_, e) => setValue((v) => ({ ...v, pac: e }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.sysproxy.fields.proxyGuard")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("settings.modals.sysproxy.tooltips.proxyGuard")}
            sx={{ opacity: "0.7" }}
          />
          <Switch
            edge="end"
            disabled={!enabled}
            checked={value.guard}
            onChange={(_, e) => setValue((v) => ({ ...v, guard: e }))}
            sx={{ marginLeft: "auto" }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.sysproxy.fields.guardDuration")}
          />
          <TextField
            disabled={!enabled}
            size="small"
            value={value.duration}
            sx={{ width: 100 }}
            slotProps={{
              input: {
                endAdornment: <InputAdornment position="end">s</InputAdornment>,
              },
            }}
            onChange={(e) => {
              setValue((v) => ({
                ...v,
                duration: +e.target.value.replace(/\D/, ""),
              }));
            }}
          />
        </ListItem>
        {!value.pac && (
          <ListItem sx={{ padding: "5px 2px" }}>
            <ListItemText
              primary={t(
                "settings.modals.sysproxy.fields.alwaysUseDefaultBypass",
              )}
            />
            <Switch
              edge="end"
              disabled={!enabled}
              checked={value.use_default}
              onChange={(_, e) =>
                setValue((v) => ({
                  ...v,
                  use_default: e,
                  // 当取消选择use_default且当前bypass为空时，填充默认值
                  bypass: !e && !v.bypass ? defaultBypass() : v.bypass,
                }))
              }
            />
          </ListItem>
        )}

        {!value.pac && !value.use_default && (
          <>
            <ListItemText
              primary={t("settings.modals.sysproxy.fields.proxyBypass")}
            />
            <TextField
              error={value.bypass ? !validReg.test(value.bypass) : false}
              disabled={!enabled}
              size="small"
              multiline
              rows={4}
              sx={{ width: "100%" }}
              value={value.bypass}
              onChange={(e) => {
                setValue((v) => ({ ...v, bypass: e.target.value }));
              }}
            />
          </>
        )}

        {!value.pac && value.use_default && (
          <>
            <ListItemText
              primary={t("settings.modals.sysproxy.fields.bypass")}
            />
            <FlexBox>
              <TextField
                disabled={true}
                size="small"
                multiline
                rows={4}
                sx={{ width: "100%" }}
                value={defaultBypass()}
              />
            </FlexBox>
          </>
        )}

        {value.pac && (
          <ListItem sx={{ padding: "5px 2px", alignItems: "start" }}>
            <ListItemText
              primary={t("settings.modals.sysproxy.fields.pacScriptContent")}
              sx={{ padding: "3px 0" }}
            />
            <Button
              startIcon={<EditRounded />}
              variant="outlined"
              onClick={() => {
                setEditorOpen(true);
              }}
            >
              {t("settings.modals.sysproxy.actions.editPac")}
            </Button>
            {editorOpen && (
              <EditorViewer
                open={true}
                title={t("settings.modals.sysproxy.actions.editPac")}
                initialData={() => Promise.resolve(value.pac_content ?? "")}
                dataKey="sysproxy-pac"
                language="javascript"
                onSave={(_prev, curr) => {
                  let pac = DEFAULT_PAC;
                  if (curr && curr.trim().length > 0) {
                    pac = curr;
                  }
                  setValue((v) => ({ ...v, pac_content: pac }));
                }}
                onClose={() => setEditorOpen(false)}
              />
            )}
          </ListItem>
        )}
      </List>
    </BaseDialog>
  );
});

const FlexBox = styled("div")`
  display: flex;
  margin-top: 4px;

  .label {
    flex: none;
    //width: 85px;
  }
`;
