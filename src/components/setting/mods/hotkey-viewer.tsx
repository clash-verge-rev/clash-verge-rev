import useSWR from "swr";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  styled,
  Typography,
} from "@mui/material";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import { ModalHandler } from "@/hooks/use-modal-handler";
import Notice from "@/components/base/base-notice";
import HotkeyInput from "./hotkey-input";

const ItemWrapper = styled("div")`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const HOTKEY_FUNC = [
  "clash_mode_rule",
  "clash_mode_global",
  "clash_mode_direct",
  "clash_mode_script",
  "toggle_system_proxy",
  "enable_system_proxy",
  "disable_system_proxy",
  "toggle_tun_mode",
  "enable_tun_mode",
  "disable_tun_mode",
];

interface Props {
  handler: ModalHandler;
}

const HotkeyViewer = ({ handler }: Props) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (handler) {
    handler.current = {
      open: () => setOpen(true),
      close: () => setOpen(false),
    };
  }

  const { data: vergeConfig, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    getVergeConfig
  );

  const [hotkeyMap, setHotkeyMap] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!open) return;
    const map = {} as typeof hotkeyMap;

    vergeConfig?.hotkeys?.forEach((text) => {
      const [func, key] = text.split(",").map((e) => e.trim());

      if (!func || !key) return;

      map[func] = key
        .split("+")
        .map((e) => e.trim())
        .map((k) => (k === "PLUS" ? "+" : k));
    });

    setHotkeyMap(map);
  }, [vergeConfig?.hotkeys, open]);

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
      patchVergeConfig({ hotkeys });
      setOpen(false);
      mutateVerge();
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <Dialog open={open} onClose={() => setOpen(false)}>
      <DialogTitle>{t("Hotkey Viewer")}</DialogTitle>

      <DialogContent sx={{ width: 450, maxHeight: 330 }}>
        {HOTKEY_FUNC.map((func) => (
          <ItemWrapper key={func}>
            <Typography>{t(func)}</Typography>
            <HotkeyInput
              value={hotkeyMap[func] ?? []}
              onChange={(v) => setHotkeyMap((m) => ({ ...m, [func]: v }))}
            />
          </ItemWrapper>
        ))}
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={() => setOpen(false)}>
          {t("Cancel")}
        </Button>
        <Button onClick={onSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default HotkeyViewer;
