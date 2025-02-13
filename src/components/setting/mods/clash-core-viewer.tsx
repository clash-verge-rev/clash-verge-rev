import { mutate } from "swr";
import {
  forwardRef,
  useImperativeHandle,
  useState,
  useCallback,
  useEffect,
} from "react";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useTranslation } from "react-i18next";
import { useVerge } from "@/hooks/use-verge";
import { useLockFn } from "ahooks";
import { LoadingButton } from "@mui/lab";
import {
  SwitchAccessShortcutRounded,
  RestartAltRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { changeClashCore, restartCore } from "@/services/cmds";
import { closeAllConnections, upgradeCore } from "@/services/api";
import { debounce } from "lodash-es";

const VALID_CORE = [
  { name: "Mihomo", core: "verge-mihomo", chip: "Release Version" },
  { name: "Mihomo Alpha", core: "verge-mihomo-alpha", chip: "Alpha Version" },
];

const OPERATION_COOLDOWN = 1000; // 1秒冷却时间
const STATE_RESET_DELAY = 2000; // 2秒状态重置延迟

export const ClashCoreViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, mutateVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [operating, setOperating] = useState(false);
  const [lastOperationTime, setLastOperationTime] = useState<number>(0);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
    close: () => setOpen(false),
  }));

  const { clash_core = "verge-mihomo" } = verge ?? {};

  const checkOperationAllowed = useCallback(() => {
    const now = Date.now();
    if (operating || now - lastOperationTime < OPERATION_COOLDOWN) {
      return false;
    }
    setLastOperationTime(now);
    return true;
  }, [operating, lastOperationTime]);

  useEffect(() => {
    let timeoutId: number | null = null;

    if (operating) {
      timeoutId = window.setTimeout(() => {
        setOperating(false);
        Notice.error(t("Operation timeout, please check the core status"));
        mutate("getClashConfig");
        mutate("getVersion");
      }, 10000); // 10秒超时
    }

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [operating]);

  const resetOperatingState = useCallback(() => {
    setOperating(false);
    setTimeout(() => {
      mutate("getClashConfig");
      mutate("getVersion");
    }, 1000);
  }, []);

  const onCoreChange = useLockFn(async (core: string) => {
    if (core === clash_core || !checkOperationAllowed()) {
      return;
    }

    try {
      setOperating(true);
      await closeAllConnections();
      await changeClashCore(core);
      mutateVerge();
      Notice.success(t("Switched to _clash Core", { core: `${core}` }), 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    } finally {
      resetOperatingState();
    }
  });

  const onRestart = useLockFn(async () => {
    if (!checkOperationAllowed()) {
      return;
    }

    try {
      setOperating(true);
      await restartCore();
      Notice.success(t(`Clash Core Restarted`), 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    } finally {
      resetOperatingState();
    }
  });

  const onUpgrade = useLockFn(async () => {
    if (!checkOperationAllowed() || upgrading) {
      return;
    }

    try {
      setUpgrading(true);
      setOperating(true);
      await upgradeCore();
      Notice.success(t(`Core Version Updated`), 1000);
    } catch (err: any) {
      Notice.error(err?.response?.data?.message || err.toString());
    } finally {
      setUpgrading(false);
      resetOperatingState();
    }
  });

  const debouncedRestart = useCallback(
    debounce(onRestart, OPERATION_COOLDOWN, {
      leading: true,
      trailing: false,
      maxWait: OPERATION_COOLDOWN,
    }),
    [onRestart],
  );

  const debouncedCoreChange = useCallback(
    debounce(onCoreChange, OPERATION_COOLDOWN, {
      leading: true,
      trailing: false,
      maxWait: OPERATION_COOLDOWN,
    }),
    [onCoreChange],
  );

  const debouncedUpgrade = useCallback(
    debounce(onUpgrade, OPERATION_COOLDOWN, {
      leading: true,
      trailing: false,
      maxWait: OPERATION_COOLDOWN,
    }),
    [onUpgrade],
  );

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent="space-between">
          {t("Clash Core")}
          <Box>
            <LoadingButton
              variant="contained"
              size="small"
              startIcon={<SwitchAccessShortcutRounded />}
              loadingPosition="start"
              loading={upgrading || operating}
              disabled={upgrading || operating}
              sx={{ marginRight: "8px" }}
              onClick={debouncedUpgrade}
            >
              {upgrading ? t("Upgrading") : t("Upgrade")}
            </LoadingButton>
            <Button
              variant="contained"
              size="small"
              onClick={debouncedRestart}
              startIcon={<RestartAltRounded />}
              disabled={operating}
            >
              {operating ? t("Operating") : t("Restart")}
            </Button>
          </Box>
        </Box>
      }
      contentSx={{
        pb: 0,
        width: 400,
        height: 180,
        overflowY: "auto",
        userSelect: "text",
        marginTop: "-8px",
      }}
      disableOk
      cancelBtn={t("Close")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    >
      <List component="nav">
        {VALID_CORE.map((each) => (
          <ListItemButton
            key={each.core}
            selected={each.core === clash_core}
            onClick={() => debouncedCoreChange(each.core)}
            disabled={operating || each.core === clash_core}
          >
            <ListItemText primary={each.name} secondary={`/${each.core}`} />
            <Chip label={t(`${each.chip}`)} size="small" />
          </ListItemButton>
        ))}
      </List>
    </BaseDialog>
  );
});
