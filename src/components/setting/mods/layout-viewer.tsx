import {
  Box,
  Button,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  styled,
} from "@mui/material";
import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { DEFAULT_HOVER_DELAY } from "@/components/proxy/proxy-group-navigator";
import { useVerge } from "@/hooks/use-verge";
import { useWindowDecorations } from "@/hooks/use-window";
import { copyIconFile, getAppDir } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import getSystem from "@/utils/get-system";

import { GuardState } from "./guard-state";

const OS = getSystem();

const clampHoverDelay = (value: number) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_HOVER_DELAY;
  }
  return Math.min(5000, Math.max(0, Math.round(value)));
};

const getIcons = async (icon_dir: string, name: string) => {
  const updateTime = localStorage.getItem(`icon_${name}_update_time`) || "";

  const icon_png = await join(icon_dir, `${name}-${updateTime}.png`);
  const icon_ico = await join(icon_dir, `${name}-${updateTime}.ico`);

  return {
    icon_png,
    icon_ico,
  };
};

export const LayoutViewer = forwardRef<DialogRef>((_, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [commonIcon, setCommonIcon] = useState("");
  const [sysproxyIcon, setSysproxyIcon] = useState("");
  const [tunIcon, setTunIcon] = useState("");

  const { decorated, toggleDecorations } = useWindowDecorations();

  useEffect(() => {
    initIconPath();
  }, []);

  async function initIconPath() {
    const appDir = await getAppDir();

    const icon_dir = await join(appDir, "icons");

    const { icon_png: common_icon_png, icon_ico: common_icon_ico } =
      await getIcons(icon_dir, "common");

    const { icon_png: sysproxy_icon_png, icon_ico: sysproxy_icon_ico } =
      await getIcons(icon_dir, "sysproxy");

    const { icon_png: tun_icon_png, icon_ico: tun_icon_ico } = await getIcons(
      icon_dir,
      "tun",
    );

    if (await exists(common_icon_ico)) {
      setCommonIcon(common_icon_ico);
    } else {
      setCommonIcon(common_icon_png);
    }
    if (await exists(sysproxy_icon_ico)) {
      setSysproxyIcon(sysproxy_icon_ico);
    } else {
      setSysproxyIcon(sysproxy_icon_png);
    }
    if (await exists(tun_icon_ico)) {
      setTunIcon(tun_icon_ico);
    } else {
      setTunIcon(tun_icon_png);
    }
  }

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onError = (err: any) => {
    showNotice.error(err);
  };
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  return (
    <BaseDialog
      open={open}
      title={t("settings.components.verge.layout.title")}
      contentSx={{ width: 450 }}
      disableOk
      cancelBtn={t("shared.actions.close")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List>
        <Item>
          <ListItemText
            primary={t(
              "settings.components.verge.layout.fields.preferSystemTitlebar",
            )}
          />
          <GuardState
            value={decorated}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={async () => {
              await toggleDecorations();
            }}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={t("settings.components.verge.layout.fields.trafficGraph")}
          />
          <GuardState
            value={verge?.traffic_graph ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ traffic_graph: e })}
            onGuard={(e) => patchVerge({ traffic_graph: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={t("settings.components.verge.layout.fields.memoryUsage")}
          />
          <GuardState
            value={verge?.enable_memory_usage ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_memory_usage: e })}
            onGuard={(e) => patchVerge({ enable_memory_usage: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={t(
              "settings.components.verge.layout.fields.proxyGroupIcon",
            )}
          />
          <GuardState
            value={verge?.enable_group_icon ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_group_icon: e })}
            onGuard={(e) => patchVerge({ enable_group_icon: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <span>
                  {t("settings.components.verge.layout.fields.hoverNavigator")}
                </span>
                <TooltipIcon
                  title={t(
                    "settings.components.verge.layout.tooltips.hoverNavigator",
                  )}
                  sx={{ opacity: "0.7" }}
                />
              </Box>
            }
          />
          <GuardState
            value={verge?.enable_hover_jump_navigator ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_hover_jump_navigator: e })}
            onGuard={(e) => patchVerge({ enable_hover_jump_navigator: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <span>
                  {t(
                    "settings.components.verge.layout.fields.hoverNavigatorDelay",
                  )}
                </span>
                <TooltipIcon
                  title={t(
                    "settings.components.verge.layout.tooltips.hoverNavigatorDelay",
                  )}
                  sx={{ opacity: "0.7" }}
                />
              </Box>
            }
          />
          <GuardState
            value={verge?.hover_jump_navigator_delay ?? DEFAULT_HOVER_DELAY}
            waitTime={400}
            onCatch={onError}
            onFormat={(e: any) => clampHoverDelay(Number(e.target.value))}
            onChange={(value) =>
              onChangeData({
                hover_jump_navigator_delay: clampHoverDelay(value),
              })
            }
            onGuard={(value) =>
              patchVerge({ hover_jump_navigator_delay: clampHoverDelay(value) })
            }
          >
            <TextField
              type="number"
              size="small"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              sx={{ width: 120 }}
              disabled={!(verge?.enable_hover_jump_navigator ?? true)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("shared.units.milliseconds")}
                    </InputAdornment>
                  ),
                },
                htmlInput: {
                  min: 0,
                  max: 5000,
                  step: 20,
                },
              }}
            />
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={t("settings.components.verge.layout.fields.navIcon")}
          />
          <GuardState
            value={verge?.menu_icon ?? "monochrome"}
            onCatch={onError}
            onFormat={(e: any) => e.target.value}
            onChange={(value) => onChangeData({ menu_icon: value })}
            onGuard={(value) => patchVerge({ menu_icon: value })}
          >
            <Select size="small" sx={{ width: 140, "> div": { py: "7.5px" } }}>
              <MenuItem value="monochrome">
                {t("settings.components.verge.layout.options.icon.monochrome")}
              </MenuItem>
              <MenuItem value="colorful">
                {t("settings.components.verge.layout.options.icon.colorful")}
              </MenuItem>
              <MenuItem value="disable">
                {t("settings.components.verge.layout.options.icon.disable")}
              </MenuItem>
            </Select>
          </GuardState>
        </Item>

        {OS === "macos" && (
          <Item>
            <ListItemText
              primary={t("settings.components.verge.layout.fields.trayIcon")}
            />
            <GuardState
              value={verge?.tray_icon ?? "monochrome"}
              onCatch={onError}
              onFormat={(e: any) => e.target.value}
              onChange={(e) => onChangeData({ tray_icon: e })}
              onGuard={(e) => patchVerge({ tray_icon: e })}
            >
              <Select
                size="small"
                sx={{ width: 140, "> div": { py: "7.5px" } }}
              >
                <MenuItem value="monochrome">
                  {t(
                    "settings.components.verge.layout.options.icon.monochrome",
                  )}
                </MenuItem>
                <MenuItem value="colorful">
                  {t("settings.components.verge.layout.options.icon.colorful")}
                </MenuItem>
              </Select>
            </GuardState>
          </Item>
        )}
        {/* {OS === "macos" && (
          <Item>
            <ListItemText primary={t("settings.components.verge.layout.fields.enableTraySpeed")} />
            <GuardState
              value={verge?.enable_tray_speed ?? false}
              valueProps="checked"
              onCatch={onError}
              onFormat={onSwitchFormat}
              onChange={(e) => onChangeData({ enable_tray_speed: e })}
              onGuard={(e) => patchVerge({ enable_tray_speed: e })}
            >
              <Switch edge="end" />
            </GuardState>
          </Item>
        )} */}
        {/* {OS === "macos" && (
          <Item>
            <ListItemText primary={t("settings.components.verge.layout.fields.enableTrayIcon")} />
            <GuardState
              value={
                verge?.enable_tray_icon === false &&
                verge?.enable_tray_speed === false
                  ? true
                  : (verge?.enable_tray_icon ?? true)
              }
              valueProps="checked"
              onCatch={onError}
              onFormat={onSwitchFormat}
              onChange={(e) => onChangeData({ enable_tray_icon: e })}
              onGuard={(e) => patchVerge({ enable_tray_icon: e })}
            >
              <Switch edge="end" />
            </GuardState>
          </Item>
        )} */}
        <Item>
          <ListItemText
            primary={t(
              "settings.components.verge.layout.fields.showProxyGroupsInline",
            )}
          />
          <GuardState
            value={verge?.tray_inline_proxy_groups ?? true}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ tray_inline_proxy_groups: e })}
            onGuard={(e) => patchVerge({ tray_inline_proxy_groups: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={t(
              "settings.components.verge.layout.fields.commonTrayIcon",
            )}
          />
          <GuardState
            value={verge?.common_tray_icon}
            onCatch={onError}
            onChange={(e) => onChangeData({ common_tray_icon: e })}
            onGuard={(e) => patchVerge({ common_tray_icon: e })}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={
                verge?.common_tray_icon &&
                commonIcon && (
                  <img height="20px" src={convertFileSrc(commonIcon)} />
                )
              }
              onClick={async () => {
                if (verge?.common_tray_icon) {
                  onChangeData({ common_tray_icon: false });
                  patchVerge({ common_tray_icon: false });
                } else {
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });

                  if (selected) {
                    await copyIconFile(`${selected}`, "common");
                    await initIconPath();
                    onChangeData({ common_tray_icon: true });
                    patchVerge({ common_tray_icon: true });
                  }
                }
              }}
            >
              {verge?.common_tray_icon
                ? t("shared.actions.clear")
                : t("settings.components.verge.basic.actions.browse")}
            </Button>
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={t(
              "settings.components.verge.layout.fields.systemProxyTrayIcon",
            )}
          />
          <GuardState
            value={verge?.sysproxy_tray_icon}
            onCatch={onError}
            onChange={(e) => onChangeData({ sysproxy_tray_icon: e })}
            onGuard={(e) => patchVerge({ sysproxy_tray_icon: e })}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={
                verge?.sysproxy_tray_icon &&
                sysproxyIcon && (
                  <img height="20px" src={convertFileSrc(sysproxyIcon)} />
                )
              }
              onClick={async () => {
                if (verge?.sysproxy_tray_icon) {
                  onChangeData({ sysproxy_tray_icon: false });
                  patchVerge({ sysproxy_tray_icon: false });
                } else {
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tray Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });
                  if (selected) {
                    await copyIconFile(`${selected}`, "sysproxy");
                    await initIconPath();
                    onChangeData({ sysproxy_tray_icon: true });
                    patchVerge({ sysproxy_tray_icon: true });
                  }
                }
              }}
            >
              {verge?.sysproxy_tray_icon
                ? t("shared.actions.clear")
                : t("settings.components.verge.basic.actions.browse")}
            </Button>
          </GuardState>
        </Item>

        <Item>
          <ListItemText
            primary={t("settings.components.verge.layout.fields.tunTrayIcon")}
          />
          <GuardState
            value={verge?.tun_tray_icon}
            onCatch={onError}
            onChange={(e) => onChangeData({ tun_tray_icon: e })}
            onGuard={(e) => patchVerge({ tun_tray_icon: e })}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={
                verge?.tun_tray_icon &&
                tunIcon && <img height="20px" src={convertFileSrc(tunIcon)} />
              }
              onClick={async () => {
                if (verge?.tun_tray_icon) {
                  onChangeData({ tun_tray_icon: false });
                  patchVerge({ tun_tray_icon: false });
                } else {
                  const selected = await openDialog({
                    directory: false,
                    multiple: false,
                    filters: [
                      {
                        name: "Tun Icon Image",
                        extensions: ["png", "ico"],
                      },
                    ],
                  });
                  if (selected) {
                    await copyIconFile(`${selected}`, "tun");
                    await initIconPath();
                    onChangeData({ tun_tray_icon: true });
                    patchVerge({ tun_tray_icon: true });
                  }
                }
              }}
            >
              {verge?.tun_tray_icon
                ? t("shared.actions.clear")
                : t("settings.components.verge.basic.actions.browse")}
            </Button>
          </GuardState>
        </Item>
      </List>
    </BaseDialog>
  );
});

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
}));
