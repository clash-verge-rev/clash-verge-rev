import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, List, ListItem, ListItemText, TextField } from "@mui/material";
import { BaseDialog, DialogRef, Notice } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { useLockFn } from "ahooks";

export const ProxyFilterViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();
  const { verge, patchVerge } = useVerge();
  const [open, setOpen] = useState(false);
  const [keywords, setKeywords] = useState(verge?.proxy_filter_keywords || "");

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setKeywords(verge?.proxy_filter_keywords || "");
    },
    close: () => setOpen(false),
  }));

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({ proxy_filter_keywords: keywords });
      setOpen(false);
      Notice.success(t("Proxy Filter Keywords Updated"), 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={t("Proxy Filter Keywords")}
      contentSx={{ width: 450 }}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem
          sx={{
            padding: "5px 2px",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <ListItemText
            primary={t("Keywords")}
            secondary={t("Use comma to separate multiple keywords")}
            sx={{ marginBottom: 1 }}
          />
          <TextField
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            size="small"
            fullWidth
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="e.g. 香港,HK,Hong Kong"
          />
        </ListItem>
      </List>
    </BaseDialog>
  );
});
