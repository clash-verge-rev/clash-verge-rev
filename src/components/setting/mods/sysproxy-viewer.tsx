import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { BaseFieldset } from "@/components/base/base-fieldset";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { EditorViewer } from "@/components/profile/editor-viewer";
import { useVerge } from "@/hooks/use-verge";
import {
  getAutotemProxy,
  getNetworkInterfaces,
  getNetworkInterfacesInfo,
  getSystemHostname,
  getSystemProxy,
  patchVergeConfig,
  restartCore,
} from "@/services/cmds.ts";
import getSystem from "@/utils/get-system.ts";
import { EditRounded } from "@mui/icons-material";
import {
  Autocomplete,
  Button,
  CircularProgress,
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
  useImperativeHandle,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";
import { showNotice } from "@/services/noticeService";
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
  const { verge, patchVerge } = useVerge();
  const [hostOptions, setHostOptions] = useState<string[]>([]);

  type SysProxy = Awaited<ReturnType<typeof getSystemProxy>>;
  const [sysproxy, setSysproxy] = useState<SysProxy>();

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
      return "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,::1";
    }
    return "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,172.29.0.0/16,localhost,*.local,*.crashlytics.com,<local>";
  };

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
      getSystemProxy().then((p) => setSysproxy(p));
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
        console.log("获取到主机名:", hostname);
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
          console.log("主机名已添加到选项中:", hostname);
        } else {
          console.log("主机名与已有选项重复:", hostname);
        }
      } else {
        console.log("主机名为空");
      }

      // 添加IP地址
      options.push(...ipAddresses);

      // 去重
      const uniqueOptions = Array.from(new Set(options));
      console.log("最终选项列表:", uniqueOptions);
      setHostOptions(uniqueOptions);
    } catch (error) {
      console.error("获取网络接口失败:", error);
      // 失败时至少提供基本选项
      setHostOptions(["127.0.0.1", "localhost"]);
    }
  };

  const onSave = useLockFn(async () => {
    if (value.duration < 1) {
      showNotice('error', t("Proxy Daemon Duration Cannot be Less than 1 Second"));
      return;
    }
    if (value.bypass && !validReg.test(value.bypass)) {
      showNotice('error', t("Invalid Bypass Format"));
      return;
    }

    // 修改验证规则，允许IP和主机名
    const ipv4Regex =
      /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex =
      /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
    const hostnameRegex =
      /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/;

    if (
      !ipv4Regex.test(value.proxy_host) &&
      !ipv6Regex.test(value.proxy_host) &&
      !hostnameRegex.test(value.proxy_host)
    ) {
      showNotice('error', t("Invalid Proxy Host Format"));
      return;
    }

    setSaving(true);
    try {
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

      await patchVerge(patch);
      
      // 更新系统代理状态，以便UI立即反映变化
      await Promise.all([mutate("getSystemProxy"), mutate("getAutotemProxy")]);
      
      // 只有在修改了影响系统代理的配置且系统代理当前启用时，才重置系统代理
      if (needResetProxy) {
        const currentSysProxy = await getSystemProxy();
        const currentAutoProxy = await getAutotemProxy();
        
        if (value.pac ? currentAutoProxy?.enable : currentSysProxy?.enable) {
          // 临时关闭系统代理
          await patchVergeConfig({ enable_system_proxy: false });
          
          // 减少等待时间
          await new Promise((resolve) => setTimeout(resolve, 200));
          
          // 重新开启系统代理
          await patchVergeConfig({ enable_system_proxy: true });
          
          // 更新UI状态
          await Promise.all([mutate("getSystemProxy"), mutate("getAutotemProxy")]);
        }
      }

      setOpen(false);
    } catch (err: any) {
      showNotice('error', err.toString());
    } finally {
      setSaving(false);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("System Proxy Setting")}
      contentSx={{ width: 450, maxHeight: 565 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
      loading={saving}
      disableOk={saving}
    >
      <List>
        <BaseFieldset label={t("Current System Proxy")} padding="15px 10px">
          <FlexBox>
            <Typography className="label">{t("Enable status")}</Typography>
            <Typography className="value">
              {value.pac
                ? autoproxy?.enable
                  ? t("Enabled")
                  : t("Disabled")
                : sysproxy?.enable
                  ? t("Enabled")
                  : t("Disabled")}
            </Typography>
          </FlexBox>
          {!value.pac && (
            <>
              <FlexBox>
                <Typography className="label">{t("Server Addr")}</Typography>
                <Typography className="value">
                  {sysproxy?.server ? sysproxy.server : t("Not available")}
                </Typography>
              </FlexBox>
            </>
          )}
          {value.pac && (
            <FlexBox>
              <Typography className="label">{t("PAC URL")}</Typography>
              <Typography className="value">{autoproxy?.url || "-"}</Typography>
            </FlexBox>
          )}
        </BaseFieldset>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Proxy Host")} />
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
          <ListItemText primary={t("Use PAC Mode")} />
          <Switch
            edge="end"
            disabled={!enabled}
            checked={value.pac}
            onChange={(_, e) => setValue((v) => ({ ...v, pac: e }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("Proxy Guard")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon title={t("Proxy Guard Info")} sx={{ opacity: "0.7" }} />
          <Switch
            edge="end"
            disabled={!enabled}
            checked={value.guard}
            onChange={(_, e) => setValue((v) => ({ ...v, guard: e }))}
            sx={{ marginLeft: "auto" }}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Guard Duration")} />
          <TextField
            disabled={!enabled}
            size="small"
            value={value.duration}
            sx={{ width: 100 }}
            slotProps={{
              input: {
                endAdornment: <InputAdornment position="end">s</InputAdornment>,
              }
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
            <ListItemText primary={t("Always use Default Bypass")} />
            <Switch
              edge="end"
              disabled={!enabled}
              checked={value.use_default}
              onChange={(_, e) => setValue((v) => ({
                ...v,
                use_default: e,
                // 当取消选择use_default且当前bypass为空时，填充默认值
                bypass: (!e && !v.bypass) ? defaultBypass() : v.bypass
              }))}
            />
          </ListItem>
        )}

        {!value.pac && !value.use_default && (
          <>
            <ListItemText primary={t("Proxy Bypass")} />
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
            <ListItemText primary={t("Bypass")} />
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
          <>
            <ListItem sx={{ padding: "5px 2px", alignItems: "start" }}>
              <ListItemText
                primary={t("PAC Script Content")}
                sx={{ padding: "3px 0" }}
              />
              <Button
                startIcon={<EditRounded />}
                variant="outlined"
                onClick={() => {
                  setEditorOpen(true);
                }}
              >
                {t("Edit")} PAC
              </Button>
              {editorOpen && (
                <EditorViewer
                  open={true}
                  title={`${t("Edit")} PAC`}
                  initialData={Promise.resolve(value.pac_content ?? "")}
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
          </>
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
