import useSWR from "swr";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton, Tooltip } from "@mui/material";
import { PrivacyTipRounded, Settings, InfoRounded } from "@mui/icons-material";
import { checkService, restartApp } from "@/services/cmds";
import { useVerge } from "@/hooks/use-verge";
import { DialogRef, Switch } from "@/components/base";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { GuardState } from "./mods/guard-state";
import { ServiceViewer } from "./mods/service-viewer";
import { SysproxyViewer } from "./mods/sysproxy-viewer";
import { TunViewer } from "./mods/tun-viewer";
import getSystem from "@/utils/get-system";
import { ConfirmViewer } from "@/components/profile/confirm-viewer";

interface Props {
  onError?: (err: Error) => void;
}

const SettingSystem = ({ onError }: Props) => {
  const systemOS = getSystem();
  const show_title_setting = systemOS === "linux" || systemOS === "windows";

  const { t } = useTranslation();

  const { verge, mutateVerge, patchVerge } = useVerge();

  // service mode
  const { data: serviceStatus } = useSWR("checkService", checkService, {
    revalidateIfStale: false,
    shouldRetryOnError: false,
    focusThrottleInterval: 36e5, // 1 hour
  });

  const serviceRef = useRef<DialogRef>(null);
  const sysproxyRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    enable_tun_mode,
    enable_auto_launch,
    enable_system_title,
    enable_keep_ui_active,
    enable_service_mode,
    enable_silent_start,
    enable_system_proxy,
  } = verge ?? {};

  const [enableSystemTitle, setEnableSystemTitle] = useState(
    enable_system_title ?? false,
  );
  // setEnableSystemTitle(enable_system_title ?? false);

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  return (
    <SettingList title={t("System Setting")}>
      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />
      <ServiceViewer ref={serviceRef} enable={!!enable_service_mode} />

      <SettingItem
        label={t("Tun Mode")}
        extra={
          <>
            <Tooltip title={t("Tun Mode Info")} placement="top">
              <IconButton color="inherit" size="small">
                <InfoRounded
                  fontSize="inherit"
                  style={{ cursor: "pointer", opacity: 0.75 }}
                />
              </IconButton>
            </Tooltip>
            <IconButton
              color="inherit"
              size="small"
              onClick={() => tunRef.current?.open()}
            >
              <Settings
                fontSize="inherit"
                style={{ cursor: "pointer", opacity: 0.75 }}
              />
            </IconButton>
          </>
        }
      >
        <GuardState
          value={enable_tun_mode ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_tun_mode: e })}
          onGuard={(e) => patchVerge({ enable_tun_mode: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("Service Mode")}
        extra={
          <IconButton
            color="inherit"
            size="small"
            onClick={() => serviceRef.current?.open()}
          >
            <PrivacyTipRounded
              fontSize="inherit"
              style={{ cursor: "pointer", opacity: 0.75 }}
            />
          </IconButton>
        }
      >
        <GuardState
          value={enable_service_mode ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_service_mode: e })}
          onGuard={(e) => patchVerge({ enable_service_mode: e })}
        >
          <Switch
            edge="end"
            disabled={
              serviceStatus !== "active" && serviceStatus !== "installed"
            }
          />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("System Proxy")}
        extra={
          <IconButton
            color="inherit"
            size="small"
            onClick={() => sysproxyRef.current?.open()}
          >
            <Settings
              fontSize="inherit"
              style={{ cursor: "pointer", opacity: 0.75 }}
            />
          </IconButton>
        }
      >
        <GuardState
          value={enable_system_proxy ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_system_proxy: e })}
          onGuard={(e) => patchVerge({ enable_system_proxy: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Auto Launch")}>
        <GuardState
          value={enable_auto_launch ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_auto_launch: e })}
          onGuard={(e) => patchVerge({ enable_auto_launch: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem label={t("Silent Start")}>
        <GuardState
          value={enable_silent_start ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_silent_start: e })}
          onGuard={(e) => patchVerge({ enable_silent_start: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      {show_title_setting && (
        <SettingItem
          label={t("System Title")}
          extra={
            <Tooltip title={t("App Title Info")} placement="top">
              <IconButton color="inherit" size="small">
                <InfoRounded
                  fontSize="inherit"
                  style={{ cursor: "pointer", opacity: 0.75 }}
                />
              </IconButton>
            </Tooltip>
          }
        >
          <GuardState
            value={enable_system_title ?? false}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => {
              setConfirmOpen(true);
              setEnableSystemTitle(e);
            }}
          >
            <Switch edge="end" />
          </GuardState>
        </SettingItem>
      )}

      <ConfirmViewer
        title="Confirm restart"
        message="Restart App Message"
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          onChangeData({ enable_system_title: enableSystemTitle });
          await patchVerge({ enable_system_title: enableSystemTitle });
          setConfirmOpen(false);
          restartApp();
        }}
      />

      <SettingItem
        label={t("Keep UI Active")}
        extra={
          <Tooltip title={t("Keep UI Active Info")} placement="top">
            <IconButton color="inherit" size="small">
              <InfoRounded
                fontSize="inherit"
                style={{ cursor: "pointer", opacity: 0.75 }}
              />
            </IconButton>
          </Tooltip>
        }
      >
        <GuardState
          value={enable_keep_ui_active ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => onChangeData({ enable_keep_ui_active: e })}
          onGuard={(e) => patchVerge({ enable_keep_ui_active: e })}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>
    </SettingList>
  );
};

export default SettingSystem;
