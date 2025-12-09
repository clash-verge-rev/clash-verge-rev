import { WarningRounded } from "@mui/icons-material";
import { Tooltip } from "@mui/material";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";

import { DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import ProxyControlSwitches from "@/components/shared/proxy-control-switches";
import { useSystemState } from "@/hooks/use-system-state";
import { useVerge } from "@/hooks/use-verge";
import { showNotice } from "@/services/notice-service";

import { GuardState } from "./mods/guard-state";
import { SettingList, SettingItem } from "./mods/setting-comp";
import { SysproxyViewer } from "./mods/sysproxy-viewer";
import { TunViewer } from "./mods/tun-viewer";

interface Props {
  onError?: (err: Error) => void;
}

const SettingSystem = ({ onError }: Props) => {
  const { t } = useTranslation();

  const { verge, mutateVerge, patchVerge } = useVerge();

  const { isAdminMode } = useSystemState();

  const { enable_auto_launch, enable_silent_start } = verge ?? {};

  const sysproxyRef = useRef<DialogRef>(null);
  const tunRef = useRef<DialogRef>(null);

  const onSwitchFormat = (
    _e: React.ChangeEvent<HTMLInputElement>,
    value: boolean,
  ) => value;
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  return (
    <SettingList title={t("settings.sections.system.title")}>
      <SysproxyViewer ref={sysproxyRef} />
      <TunViewer ref={tunRef} />

      <ProxyControlSwitches
        label={t("settings.sections.system.toggles.tunMode")}
        onError={onError}
      />

      <ProxyControlSwitches
        label={t("settings.sections.system.toggles.systemProxy")}
        onError={onError}
      />

      <SettingItem
        label={t("settings.sections.system.fields.autoLaunch")}
        extra={
          isAdminMode && (
            <Tooltip
              title={t("settings.sections.system.tooltips.autoLaunchAdmin")}
            >
              <WarningRounded sx={{ color: "warning.main", mr: 1 }} />
            </Tooltip>
          )
        }
      >
        <GuardState
          value={enable_auto_launch ?? false}
          valueProps="checked"
          onCatch={onError}
          onFormat={onSwitchFormat}
          onChange={(e) => {
            // 移除管理员模式检查提示
            onChangeData({ enable_auto_launch: e });
          }}
          onGuard={async (e) => {
            if (isAdminMode) {
              showNotice.info(
                "settings.sections.system.tooltips.autoLaunchAdmin",
              );
            }

            try {
              // 先触发UI更新立即看到反馈
              onChangeData({ enable_auto_launch: e });
              await patchVerge({ enable_auto_launch: e });
              await mutate("getAutoLaunchStatus");
              return Promise.resolve();
            } catch (error) {
              // 如果出错，恢复原始状态
              onChangeData({ enable_auto_launch: !e });
              return Promise.reject(error);
            }
          }}
        >
          <Switch edge="end" />
        </GuardState>
      </SettingItem>

      <SettingItem
        label={t("settings.sections.system.fields.silentStart")}
        extra={
          <TooltipIcon
            title={t("settings.sections.system.tooltips.silentStart")}
            sx={{ opacity: "0.7" }}
          />
        }
      >
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
    </SettingList>
  );
};

export default SettingSystem;
