import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import { styled, Typography } from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { HotkeyInput } from "./hotkey-input";

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
];

export const HotkeyViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { verge, patchVerge } = useVerge();

  const [hotkeyMap, setHotkeyMap] = useState<Record<string, string[]>>({});

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
      await patchVerge({ hotkeys });
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Hotkey Setting")}
      contentSx={{ width: 450, maxHeight: 330 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
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
