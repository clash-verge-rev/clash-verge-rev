import { forwardRef, useImperativeHandle, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
  InputAdornment,
} from "@mui/material";
import { useVerge } from "@/hooks/use-verge";
import { BaseDialog, DialogRef, Notice, Switch } from "@/components/base";
import { TooltipIcon } from "@/components/base/base-tooltip-icon";
import { entry_lightweight_mode } from "@/services/cmds";

export const LiteModeViewer = forwardRef<DialogRef>((props, ref) => {
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
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("LightWeight Mode Settings")}
      contentSx={{ width: 450 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Enter LightWeight Mode Now")} />
          <Typography
            variant="button"
            sx={{
              cursor: "pointer",
              color: "primary.main",
              "&:hover": { textDecoration: "underline" },
            }}
            onClick={async () => await entry_lightweight_mode()}
          >
            {t("Enable")}
          </Typography>
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText
            primary={t("Auto Enter LightWeight Mode")}
            sx={{ maxWidth: "fit-content" }}
          />
          <TooltipIcon
            title={t("Auto Enter LightWeight Mode Info")}
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
              <ListItemText primary={t("Auto Enter LightWeight Mode Delay")} />
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
                        {t("mins")}
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
                {t(
                  "When closing the window, LightWeight Mode will be automatically activated after _n minutes",
                  { n: values.autoEnterLiteModeDelay },
                )}
              </Typography>
            </ListItem>
          </>
        )}
      </List>
    </BaseDialog>
  );
});
