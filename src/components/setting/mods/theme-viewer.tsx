import { BaseDialog, DialogRef, EditorViewer, Notice } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { defaultDarkTheme, defaultTheme } from "@/pages/_theme";
import {
  Button,
  Input,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  useTheme,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

export const ThemeViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const { verge, patchVerge } = useVerge();
  const { theme_setting } = verge ?? {};
  const [theme, setTheme] = useState(theme_setting || {});
  const [cssEditorOpen, setCssEditorOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setTheme({ ...theme_setting } || {});
    },
    close: () => setOpen(false),
  }));

  const textProps = {
    size: "small",
    autoComplete: "off",
    sx: { width: 135 },
  } as const;

  const handleChange = (field: keyof typeof theme) => (e: any) => {
    setTheme((t) => ({ ...t, [field]: e.target.value }));
  };

  const handleCSSInjection = (css: string) => {
    setTheme((t) => ({ ...t, css_injection: css }));
  };

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({ theme_setting: theme });
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  // default theme
  const { palette } = useTheme();

  const dt = palette.mode === "light" ? defaultTheme : defaultDarkTheme;

  type ThemeKey = keyof typeof theme & keyof typeof defaultTheme;

  const renderItem = (label: string, key: ThemeKey) => {
    return (
      <Item>
        <ListItemText primary={label} />
        <Round sx={{ background: theme[key] || dt[key] }} />
        <TextField
          {...textProps}
          value={theme[key] ?? ""}
          placeholder={dt[key]}
          onChange={handleChange(key)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
        />
      </Item>
    );
  };

  return (
    <BaseDialog
      open={open}
      title={t("Theme Setting")}
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      contentSx={{ width: 400, maxHeight: 600, overflow: "auto", pb: 0 }}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}>
      <List sx={{ pt: 0 }}>
        {renderItem("Primary Color", "primary_color")}

        {renderItem("Secondary Color", "secondary_color")}

        {renderItem("Primary Text", "primary_text")}

        {renderItem("Secondary Text", "secondary_text")}

        {renderItem("Info Color", "info_color")}

        {renderItem("Error Color", "error_color")}

        {renderItem("Warning Color", "warning_color")}

        {renderItem("Success Color", "success_color")}

        <Item>
          <ListItemText primary="Font Family" />
          <TextField
            {...textProps}
            value={theme.font_family ?? ""}
            onChange={handleChange("font_family")}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
          />
        </Item>

        <Item>
          <ListItemText primary="CSS Injection" />
          <Input
            value={theme.css_injection ?? ""}
            disabled
            sx={{ width: 230 }}
            endAdornment={
              <Button
                onClick={() => {
                  setCssEditorOpen(true);
                }}>
                {t("Edit")}
              </Button>
            }
          />
        </Item>
        <EditorViewer
          open={cssEditorOpen}
          mode="text"
          language={"css"}
          property={theme.css_injection ?? ""}
          onChange={(css) => handleCSSInjection(css)}
          onClose={() => setCssEditorOpen(false)}
        />
      </List>
    </BaseDialog>
  );
});

const Item = styled(ListItem)(() => ({
  padding: "5px 2px",
}));

const Round = styled("div")(() => ({
  width: "24px",
  height: "24px",
  borderRadius: "18px",
  display: "inline-block",
  marginRight: "8px",
}));
