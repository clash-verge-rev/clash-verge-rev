import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, Switch } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { SettingItem } from "./setting-comp";
import { GuardState } from "./guard-state";

export const LayoutViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onError = (err: any) => {
    Notice.error(err.message || err.toString());
  };
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  return (
    <BaseDialog
      open={open}
      title={t("Layout Setting")}
      contentSx={{ width: 450 }}
      disableOk
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List>
        <SettingItem label={t("Theme Blur")}>
          <GuardState
            value={verge?.theme_blur ?? false}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ theme_blur: e })}
            onGuard={(e) => patchVerge({ theme_blur: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </SettingItem>

        <SettingItem label={t("Traffic Graph")}>
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
        </SettingItem>

        <SettingItem label={t("Memory Usage")}>
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
        </SettingItem>
      </List>
    </BaseDialog>
  );
});
