import {
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import type { Ref } from "react";
import { useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { useVerge } from "@/hooks/use-verge";
import { entry_lightweight_mode } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

export function LiteModeViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    autoEnterLiteMode: false,
    autoEnterLiteModeDelay: 10, // 默认10分钟
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setValues({
        autoEnterLiteMode: verge?.enable_auto_light_weight_mode ?? false,
        autoEnterLiteModeDelay: verge?.auto_light_weight_minutes ?? 10,
      });
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({
        enable_auto_light_weight_mode: values.autoEnterLiteMode,
        auto_light_weight_minutes: values.autoEnterLiteModeDelay,
      });
      setOpen(false);
    } catch (err) {
      showNotice.error(err);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("settings.modals.liteMode.title")}
      contentSx={{ width: 450 }}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.liteMode.actions.enterNow")}
          />
          <Typography
            variant="button"
            sx={{
              cursor: "pointer",
              color: "primary.main",
              "&:hover": { textDecoration: "underline" },
            }}
            onClick={async () => await entry_lightweight_mode()}
          >
            {t("shared.actions.enable")}
          </Typography>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("settings.modals.liteMode.toggles.autoEnter")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("settings.modals.liteMode.tooltips.autoEnter")}
            sx={{ opacity: "0.7" }}
          />
          <Switch
            edge="end"
            checked={values.autoEnterLiteMode}
            onChange={(_, c) =>
              setValues((v) => ({ ...v, autoEnterLiteMode: c }))
            }
            sx={{ marginLeft: "auto" }}
          />
        </ListItem>

        {values.autoEnterLiteMode && (
          <>
            <ListItem sx={{ padding: "5px 2px" }}>
              <ListItemText
                primary={t("settings.modals.liteMode.fields.delay")}
              />
              <TextField
                autoComplete="off"
                size="small"
                type="number"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                sx={{ width: 150 }}
                value={values.autoEnterLiteModeDelay}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    autoEnterLiteModeDelay: parseInt(e.target.value) || 1,
                  }))
                }
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        {t("shared.units.minutes")}
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </ListItem>

            <ListItem sx={{ padding: "5px 2px" }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontStyle: "italic" }}
              >
                {t("settings.modals.liteMode.messages.autoEnterHint", {
                  n: values.autoEnterLiteModeDelay,
                })}
              </Typography>
            </ListItem>
          </>
        )}
      </List>
    </BaseDialog>
  );
}
