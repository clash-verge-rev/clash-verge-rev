import { BaseDialog, DialogRef, Notice, Switch } from "@/components/base";
import { BaseFieldset } from "@/components/base/base-fieldset";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { EditorViewer } from "@/components/profile/editor-viewer";
import { useVerge } from "@/hooks/use-verge";
import { getAutotemProxy, getSystemProxy } from "@/services/cmds";
import getSystem from "@/utils/get-system";
import { EditRounded } from "@mui/icons-material";
import {
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
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
const DEFAULT_PAC = `function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
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
  const { verge, patchVerge } = useVerge();

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
  } = verge ?? {};

  const [value, setValue] = useState({
    guard: enable_proxy_guard,
    bypass: system_proxy_bypass,
    duration: proxy_guard_duration ?? 10,
    use_default: use_default_bypass ?? true,
    pac: proxy_auto_config,
    pac_content: pac_file_content ?? DEFAULT_PAC,
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
      });
      getSystemProxy().then((p) => setSysproxy(p));
      getAutotemProxy().then((p) => setAutoproxy(p));
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    if (value.duration < 1) {
      Notice.error(t("Proxy Daemon Duration Cannot be Less than 1 Second"));
      return;
    }
    if (value.bypass && !validReg.test(value.bypass)) {
      Notice.error(t("Invalid Bypass Format"));
      return;
    }

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
    if (value.pac_content !== pac_file_content) {
      patch.pac_file_content = value.pac_content;
    }

    try {
      await patchVerge(patch);
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
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
            InputProps={{
              endAdornment: <InputAdornment position="end">s</InputAdornment>,
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
              onChange={(_, e) => setValue((v) => ({ ...v, use_default: e }))}
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
