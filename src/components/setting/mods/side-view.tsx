import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { List, styled, ListItem, ListItemText } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { GuardState } from "./guard-state";
import { showNotice } from "@/services/noticeService";

export const SideViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const isFlowOverallEnabled = verge?.enable_side_control ?? true;

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const onSwitchFormat = (_e: any, value: boolean) => value;
  const onError = (err: any) => {
    showNotice("error", err.message || err.toString());
  };
  const onChangeData = (patch: Partial<IVergeConfig>) => {
    mutateVerge({ ...verge, ...patch }, false);
  };

  return (
    <BaseDialog
      open={open}
      title={t("Side Setting")}
      contentSx={{ width: 450 }}
      disableOk
      cancelBtn={t("Close")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List>
        <Item>
          <ListItemText primary={t("Flow overall")} />
          <GuardState
            value={isFlowOverallEnabled}
            valueProps="checked"
            onCatch={onError}
            onFormat={onSwitchFormat}
            onChange={(e) => onChangeData({ enable_side_control: e })}
            onGuard={(e) => patchVerge({ enable_side_control: e })}
          >
            <Switch edge="end" />
          </GuardState>
        </Item>

        {isFlowOverallEnabled && (
          <>
            <Item>
              <ListItemText primary={t("Traffic Graph")} />
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
              <ListItemText primary={t("Download speed")} />
              <GuardState
                value={verge?.enable_download_speed ?? true}
                valueProps="checked"
                onCatch={onError}
                onFormat={onSwitchFormat}
                onChange={(e) => onChangeData({ enable_download_speed: e })}
                onGuard={(e) => patchVerge({ enable_download_speed: e })}
              >
                <Switch edge="end" />
              </GuardState>
            </Item>

            <Item>
              <ListItemText primary={t("Memory Usage")} />
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
              <ListItemText primary={t("Uptime")} />
              <GuardState
                value={verge?.enable_runtime_display ?? false}
                valueProps="checked"
                onCatch={onError}
                onFormat={onSwitchFormat}
                onChange={(e) => onChangeData({ enable_runtime_display: e })}
                onGuard={(e) => patchVerge({ enable_runtime_display: e })}
              >
                <Switch edge="end" />
              </GuardState>
            </Item>

            <Item>
              <ListItemText primary={t("System Time")} />
              <GuardState
                value={verge?.enable_system_time ?? false}
                valueProps="checked"
                onCatch={onError}
                onFormat={onSwitchFormat}
                onChange={(e) => onChangeData({ enable_system_time: e })}
                onGuard={(e) => patchVerge({ enable_system_time: e })}
              >
                <Switch edge="end" />
              </GuardState>
            </Item>
          </>
        )}
      </List>
    </BaseDialog>
  );
});

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
}));
