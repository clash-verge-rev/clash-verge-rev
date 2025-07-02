import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { styled, Typography } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef } from "@/components/base";
import { HotkeyInput } from "./hotkey-input";
import { showNotice } from "@/services/noticeService";

// 修复后的自定义开关组件
const ToggleButton = styled("label")`
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;

  input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #e0e0e0;
    transition: 0.4s;
    border-radius: 34px;

    &:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: 0.4s;
      border-radius: 50%;
    }
  }

  input:checked + .slider {
    background-color: #2196f3;
  }

  input:focus + .slider {
    box-shadow: 0 0 1px #2196f3;
  }

  input:checked + .slider:before {
    transform: translateX(24px);
  }
`;

const ItemWrapper = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const HOTKEY_FUNC = [
  "open_or_close_dashboard",
  "clash_mode_rule",
  "clash_mode_global",
  "clash_mode_direct",
  "toggle_system_proxy",
  "toggle_tun_mode",
  "entry_lightweight_mode",
];

export const HotkeyViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { verge, patchVerge } = useVerge();

  const [hotkeyMap, setHotkeyMap] = useState<Record<string, string[]>>({});
  const [enableGlobalHotkey, setEnableHotkey] = useState(
    verge?.enable_global_hotkey ?? true,
  );

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);

      const map = {} as typeof hotkeyMap;

      verge?.hotkeys?.forEach((text) => {
        const [func, key] = text.split(",").map((e) => e.trim());

        if (!func || !key) return;

        map[func] = key
          .split("+")
          .map((e) => e.trim())
          .map((k) => (k === "PLUS" ? "+" : k));
      });

      setHotkeyMap(map);
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    const hotkeys = Object.entries(hotkeyMap)
      .map(([func, keys]) => {
        if (!func || !keys?.length) return "";

        const key = keys
          .map((k) => k.trim())
          .filter(Boolean)
          .map((k) => (k === "+" ? "PLUS" : k))
          .join("+");

        if (!key) return "";
        return `${func},${key}`;
      })
      .filter(Boolean);

    try {
      await patchVerge({
        hotkeys,
        enable_global_hotkey: enableGlobalHotkey,
      });
      setOpen(false);
    } catch (err: any) {
      showNotice("error", err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Hotkey Setting")}
      contentSx={{ width: 450, maxHeight: 380 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <ItemWrapper style={{ marginBottom: 16 }}>
        <Typography>{t("Enable Global Hotkey")}</Typography>
        <ToggleButton>
          <input
            type="checkbox"
            checked={enableGlobalHotkey}
            onChange={(e) => setEnableHotkey(e.target.checked)}
            id="global-hotkey-toggle"
          />
          <span className="slider"></span>
        </ToggleButton>
      </ItemWrapper>

      {HOTKEY_FUNC.map((func) => (
        <ItemWrapper key={func}>
          <Typography>{t(func)}</Typography>
          <HotkeyInput
            value={hotkeyMap[func] ?? []}
            onChange={(v) => setHotkeyMap((m) => ({ ...m, [func]: v }))}
          />
        </ItemWrapper>
      ))}
    </BaseDialog>
  );
});
