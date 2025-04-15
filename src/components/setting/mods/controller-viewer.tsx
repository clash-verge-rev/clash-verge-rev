import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { List, ListItem, ListItemText, TextField, Typography, Box } from "@mui/material";
import { useClashInfo } from "@/hooks/use-clash";
import { BaseDialog, DialogRef, Notice, Switch } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";

export const ControllerViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const { clashInfo, patchInfo } = useClashInfo();
  const { verge, patchVerge } = useVerge();

  const [controller, setController] = useState(clashInfo?.server || "");
  const [secret, setSecret] = useState(clashInfo?.secret || "");
  
  // 获取外部控制器开关状态
  const [enableController, setEnableController] = useState(() => {
    const savedState = localStorage.getItem("enable_external_controller");
    if (savedState !== null) {
      return savedState === "true";
    }
    return verge?.enable_external_controller ?? true;
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setController(clashInfo?.server || "");
      setSecret(clashInfo?.secret || "");
      // 从localStorage更新开关状态
      const savedState = localStorage.getItem("enable_external_controller");
      if (savedState !== null) {
        setEnableController(savedState === "true");
      } else {
        setEnableController(verge?.enable_external_controller ?? true);
      }
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      // 只有在启用外部控制器时才更新配置
      if (enableController) {
        await patchInfo({ "external-controller": controller, secret });
      }
      Notice.success(t("External Controller Settings Saved"), 1000);
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 4000);
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("External Controller")}
      contentSx={{ width: 400 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <Box>
        <Typography variant="body2" color={enableController ? "warning.main" : "text.secondary"}>
          {enableController 
            ? t("External controller is enabled info") 
            : t("External controller is disabled info")}
        </Typography>
      </Box>
      
      <List>
        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("External Controller Address")} />
          <TextField
            autoComplete="new-password"
            size="small"
            sx={{ width: 175 }}
            value={controller}
            placeholder="Required"
            onChange={(e) => setController(e.target.value)}
            disabled={!enableController}
          />
        </ListItem>

        <ListItem sx={{ padding: "5px 2px" }}>
          <ListItemText primary={t("Core Secret")} />
          <TextField
            autoComplete="new-password"
            size="small"
            sx={{ width: 175 }}
            value={secret}
            placeholder={t("Recommended")}
            onChange={(e) =>
              setSecret(e.target.value?.replace(/[^\x00-\x7F]/g, ""))
            }
            disabled={!enableController}
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
