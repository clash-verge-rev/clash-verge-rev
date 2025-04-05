import { BaseDialog, DialogRef, EditorViewer, Notice } from "@/components/base";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useVerge } from "@/hooks/use-verge";
import { useThemeMode, useThemeSettings } from "@/services/states";
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
import ThemeColorSelect from "./theme-color-select";

export const ThemeViewer = forwardRef<DialogRef>((props, ref) => {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const { verge, patchVerge } = useVerge();
  const { light_theme_setting, dark_theme_setting } = verge || {};
  const { toggleTheme } = useCustomTheme();
  const themeMode = useThemeMode();
  const [themeSettings, setThemeSettings] = useThemeSettings();
  const theme =
    (themeMode === "light" ? themeSettings.light : themeSettings.dark) ?? {};
  const [editorOpen, setEditorOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
    },
    close: () => setOpen(false),
  }));

  const textProps = {
    size: "small",
    autoComplete: "off",
    sx: { width: 135 },
  } as const;

  const handleChange = (field: keyof typeof theme) => (e: any) => {
    const value = e.target.value as string;
    setThemeSettings((t: any) => {
      return themeMode === "light"
        ? { ...t, light: { ...t.light, [field]: value } }
        : { ...t, dark: { ...t.dark, [field]: value } };
    });
  };

  const handleCSSInjection = (css: string) => {
    setThemeSettings((t: any) => {
      return themeMode === "light"
        ? { ...t, light: { ...t.light, css_injection: css } }
        : { ...t, dark: { ...t.dark, css_injection: css } };
    });
  };

  const onSave = useLockFn(async () => {
    try {
      patchVerge({
        light_theme_setting: themeSettings.light,
        dark_theme_setting: themeSettings.dark,
      });
      setOpen(false);
    } catch (err: any) {
      Notice.error(err.message || err.toString());
    }
  });

  return (
    <BaseDialog
      open={open}
      title={
        <Box display="flex" justifyContent={"space-between"} gap={1}>
          <Typography variant="h6">{t("Theme Setting")}</Typography>
          <div className="flex items-center justify-between">
            <Button
              className="!text-primary-text !mr-2"
              onClick={() => {
                setThemeSettings((prev: any) => ({
                  ...prev,
                  [themeMode]: {},
                }));
              }}>
              {t("Default Color")}
            </Button>
            <ButtonGroup size="small">
              <Button
                variant={themeMode === "light" ? "contained" : "outlined"}
                onClick={(e) => {
                  toggleTheme(e, "light");
                }}>
                {t("theme.light")}
              </Button>
              <Button
                variant={themeMode === "dark" ? "contained" : "outlined"}
                onClick={(e) => {
                  toggleTheme(e, "dark");
                }}>
                {t("theme.dark")}
              </Button>
            </ButtonGroup>
          </div>
        </Box>
      }
      okBtn={t("Save")}
      cancelBtn={t("Cancel")}
      onClose={() => {
        setThemeSettings({
          light: light_theme_setting ?? {},
          dark: dark_theme_setting ?? {},
        });
        setOpen(false);
      }}
      onCancel={() => {
        setThemeSettings({
          light: light_theme_setting ?? {},
          dark: dark_theme_setting ?? {},
        });
        setOpen(false);
      }}
      onOk={onSave}>
      <List sx={{ pt: 0 }}>
        <ThemeColorSelect label="Primary Color" themeKey="primary_color" />
        <ThemeColorSelect label="Secondary Color" themeKey="secondary_color" />
        <ThemeColorSelect label="Primary Text" themeKey="primary_text" />
        <ThemeColorSelect label="Secondary Text" themeKey="secondary_text" />
        <ThemeColorSelect label="Info Color" themeKey="info_color" />
        <ThemeColorSelect label="Error Color" themeKey="error_color" />
        <ThemeColorSelect label="Warning Color" themeKey="warning_color" />
        <ThemeColorSelect label="Success Color" themeKey="success_color" />

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
          language="css"
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
