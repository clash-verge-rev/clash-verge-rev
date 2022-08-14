import useSWR from "swr";
import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  useTheme,
} from "@mui/material";
import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import { defaultTheme, defaultDarkTheme } from "@/pages/_theme";

interface Props {
  open: boolean;
  onClose: () => void;
  onError?: (err: Error) => void;
}

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

const SettingTheme = (props: Props) => {
  const { open, onClose, onError } = props;

  const { t } = useTranslation();
  const { data: vergeConfig, mutate } = useSWR(
    "getVergeConfig",
    getVergeConfig
  );

  const { theme_setting } = vergeConfig ?? {};
  const [theme, setTheme] = useState(theme_setting || {});

  useEffect(() => {
    setTheme({ ...theme_setting } || {});
  }, [theme_setting]);

  const textProps = {
    size: "small",
    autoComplete: "off",
    sx: { width: 135 },
  } as const;

  const handleChange = (field: keyof typeof theme) => (e: any) => {
    setTheme((t) => ({ ...t, [field]: e.target.value }));
  };

  const onSave = useLockFn(async () => {
    try {
      await patchVergeConfig({ theme_setting: theme });
      mutate();
      onClose();
    } catch (err: any) {
      onError?.(err);
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
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("Theme Setting")}</DialogTitle>

      <DialogContent
        sx={{ width: 400, maxHeight: 300, overflow: "auto", pb: 0 }}
      >
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
            <TextField
              {...textProps}
              value={theme.css_injection ?? ""}
              onChange={handleChange("css_injection")}
              onKeyDown={(e) => e.key === "Enter" && onSave()}
            />
          </Item>
        </List>
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button onClick={onSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SettingTheme;
