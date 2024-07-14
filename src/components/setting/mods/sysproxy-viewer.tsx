import {
  BaseDialog,
  BaseFieldset,
  DialogRef,
  EditorViewer,
  Notice,
  SwitchLovely,
} from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { getAutotemProxy, getSystemProxy } from "@/services/cmds";
import getSystem from "@/utils/get-system";
import { InfoRounded } from "@mui/icons-material";
import {
  Button,
  IconButton,
  Input,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  Tooltip,
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
// 127.0.0.1 (full ipv4)
const rIPv4 = String.raw`(?:${ipv4_part}\.){3}${ipv4_part}`;
// const rIPv4Partial = String.raw`${ipv4_part}\.(?:(?:${ipv4_part}|\*)\.){0,2}\.\*`;

const ipv6_part = "(?:[a-fA-F0-9:])+";
const rIPv6 = `(?:${ipv6_part}:+)+${ipv6_part}`;

const rLocal = `localhost|<local>|localdomain`;
const rValidPart = `${rDomainSimple}|${rIPv4}|${rIPv6}|${rLocal}`;

const getValidReg = (isWindows: boolean) => {
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
    system_proxy_bypass,
    proxy_guard_duration,
  } = verge ?? {};

  const [value, setValue] = useState({
    guard: enable_proxy_guard,
    bypass: system_proxy_bypass,
    duration: proxy_guard_duration ?? 10,
    pac: proxy_auto_config,
    pac_content: pac_file_content ?? DEFAULT_PAC,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValue({
        guard: enable_proxy_guard,
        bypass: system_proxy_bypass,
        duration: proxy_guard_duration ?? 10,
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
    if (value.pac_content !== pac_file_content) {
      patch.pac_file_content = value.pac_content;
    }
    if (value.bypass && !validReg.test(value.bypass)) {
      Notice.error(t("Invalid Bypass Format"));
      return;
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
      onOk={onSave}>
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
          <SwitchLovely
            edge="end"
            disabled={!enabled}
            checked={value.pac}
            onChange={(_, e) => setValue((v) => ({ ...v, pac: e }))}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Proxy Guard")} />
          <Tooltip title={t("Proxy Guard Info")}>
            <IconButton color="inherit" size="small">
              <InfoRounded
                fontSize="inherit"
                style={{ cursor: "pointer", opacity: 0.75 }}
              />
            </IconButton>
          </Tooltip>
          <SwitchLovely
            edge="end"
            disabled={!enabled}
            checked={value.guard}
            onChange={(_, e) => setValue((v) => ({ ...v, guard: e }))}
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
          <>
            <ListItemText primary={t("Proxy Bypass")} />
            <TextField
              error={value.bypass ? !validReg.test(value.bypass) : false}
              disabled={!enabled}
              size="small"
              autoComplete="off"
              multiline
              rows={4}
              sx={{ width: "100%" }}
              value={value.bypass}
              onChange={(e) => {
                setValue((v) => ({ ...v, bypass: e.target.value }));
              }}
            />
            <ListItemText primary={t("Bypass")} />
            <FlexBox>
              <TextField
                disabled={true}
                size="small"
                autoComplete="off"
                multiline
                rows={4}
                sx={{ width: "100%" }}
                value={sysproxy?.bypass || "-"}
              />
            </FlexBox>
          </>
        )}
        {value.pac && (
          <>
            <ListItem sx={{ padding: "5px 2px", alignItems: "start" }}>
              <ListItemText primary={t("PAC Script Content")} />
              <Input
                value={value.pac_content ?? ""}
                disabled
                sx={{ width: 230 }}
                endAdornment={
                  <Button
                    onClick={() => {
                      setEditorOpen(true);
                    }}>
                    {t("Edit")}
                  </Button>
                }
              />
              <EditorViewer
                title={`${t("Edit")} PAC`}
                open={editorOpen}
                mode="text"
                scope="pac"
                language="javascript"
                property={value.pac_content ?? ""}
                onChange={(content) => {
                  let pac = DEFAULT_PAC;
                  if (content.trim().length > 0) {
                    pac = content;
                  }
                  setValue((v) => ({ ...v, pac_content: pac }));
                }}
                onClose={() => {
                  setEditorOpen(false);
                }}
              />
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
