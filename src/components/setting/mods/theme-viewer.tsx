import { BaseDialog, DialogRef, EditorViewer, Notice } from "@/components/base";
import { useVerge } from "@/hooks/use-verge";
import { defaultDarkTheme, defaultTheme } from "@/pages/_theme";
import {
  Box,
  Button,
  ButtonGroup,
  Input,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

export const ThemeViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const { verge, patchVerge } = useVerge();
  const { theme_mode } = verge ?? {};
  const [themeMode, setThemeMode] = useState(theme_mode ?? "light");
  const [themeSettings, setThemeSettings] = useState({
    light_theme_setting: verge?.light_theme_setting ?? {},
    dark_theme_setting: verge?.dark_theme_setting ?? {},
  });
  const theme =
    themeMode === "light"
      ? themeSettings.light_theme_setting
      : themeSettings.dark_theme_setting;
  const [editorOpen, setEditorOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setThemeMode(theme_mode ?? "light");
      setThemeSettings({
        light_theme_setting: verge?.light_theme_setting ?? {},
        dark_theme_setting: verge?.dark_theme_setting ?? {},
      });
    },
    close: () => setOpen(false),
  }));

  const textProps = {
    size: "small",
    autoComplete: "off",
    sx: { width: 135 },
  } as const;

  const handleChange = (field: keyof typeof theme) => (e: any) => {
    setThemeSettings((t) => {
      return themeMode === "light"
        ? {
            ...t,
            light_theme_setting: {
              ...t.light_theme_setting,
              [field]: e.target.value,
            },
          }
        : {
            ...t,
            dark_theme_setting: {
              ...t.dark_theme_setting,
              [field]: e.target.value,
            },
          };
    });
  };

  const handleCSSInjection = (css: string) => {
    setThemeSettings((t) => {
      return themeMode === "light"
        ? {
            ...t,
            light_theme_setting: {
              ...t.light_theme_setting,
              css_injection: css,
            },
          }
        : {
            ...t,
            dark_theme_setting: { ...t.dark_theme_setting, css_injection: css },
          };
    });
  };

  const onSave = useLockFn(async () => {
    try {
      await patchVerge(themeSettings);
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  // default theme
  const dt = themeMode === "light" ? defaultTheme : defaultDarkTheme;

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
      title={
        // t("Theme Setting")
        <Box display="flex" justifyContent={"space-between"} gap={1}>
          <Typography variant="h6">{t("Theme Setting")}</Typography>
          <ButtonGroup size="small">
            <Button
              variant={themeMode === "light" ? "contained" : "outlined"}
              onClick={() => {
                setThemeMode("light");
              }}>
              {t("theme.light")}
            </Button>
            <Button
              variant={themeMode === "dark" ? "contained" : "outlined"}
              onClick={() => {
                setThemeMode("dark");
              }}>
              {t("theme.dark")}
            </Button>
          </ButtonGroup>
        </Box>
      }
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
              <Button onClick={() => setEditorOpen(true)}>{t("Edit")}</Button>
            }
          />
        </Item>
        <EditorViewer
          open={editorOpen}
          mode="text"
          language={"css"}
          property={theme.css_injection ?? ""}
          onChange={(css) => handleCSSInjection(css)}
          onClose={() => setEditorOpen(false)}
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
