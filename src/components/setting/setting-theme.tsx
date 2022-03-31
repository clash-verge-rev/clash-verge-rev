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
} from "@mui/material";
import { getVergeConfig, patchVergeConfig } from "../../services/cmds";
import { defaultTheme } from "../../pages/_theme";

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

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t("Theme Setting")}</DialogTitle>

      <DialogContent
        sx={{ width: 400, maxHeight: 300, overflow: "auto", pb: 0 }}
      >
        <List sx={{ pt: 0 }}>
          <Item>
            <ListItemText primary="Primary Color" />

            <Round
              sx={{
                background: theme.primary_color || defaultTheme.primary_color,
              }}
            />
            <TextField
              {...textProps}
              value={theme.primary_color ?? ""}
              placeholder={defaultTheme.primary_color}
              onChange={handleChange("primary_color")}
            />
          </Item>

          <Item>
            <ListItemText primary="Secondary Color" />

            <Round
              sx={{
                background:
                  theme.secondary_color || defaultTheme.secondary_color,
              }}
            />
            <TextField
              {...textProps}
              value={theme.secondary_color ?? ""}
              placeholder={defaultTheme.secondary_color}
              onChange={handleChange("secondary_color")}
            />
          </Item>

          <Item>
            <ListItemText primary="Info Color" />

            <Round
              sx={{
                background: theme.info_color || defaultTheme.info_color,
              }}
            />
            <TextField
              {...textProps}
              value={theme.info_color ?? ""}
              placeholder={defaultTheme.info_color}
              onChange={handleChange("info_color")}
            />
          </Item>

          <Item>
            <ListItemText primary="Error Color" />

            <Round
              sx={{
                background: theme.error_color || defaultTheme.error_color,
              }}
            />
            <TextField
              {...textProps}
              value={theme.error_color ?? ""}
              placeholder={defaultTheme.error_color}
              onChange={handleChange("error_color")}
            />
          </Item>

          <Item>
            <ListItemText primary="Warning Color" />

            <Round
              sx={{
                background: theme.warning_color || defaultTheme.warning_color,
              }}
            />
            <TextField
              {...textProps}
              value={theme.warning_color ?? ""}
              placeholder={defaultTheme.warning_color}
              onChange={handleChange("warning_color")}
            />
          </Item>

          <Item>
            <ListItemText primary="Success Color" />

            <Round
              sx={{
                background: theme.success_color || defaultTheme.success_color,
              }}
            />
            <TextField
              {...textProps}
              value={theme.success_color ?? ""}
              placeholder={defaultTheme.success_color}
              onChange={handleChange("success_color")}
            />
          </Item>

          <Item>
            <ListItemText primary="Font Family" />

            <TextField
              {...textProps}
              value={theme.font_family ?? ""}
              onChange={handleChange("font_family")}
            />
          </Item>

          <Item>
            <ListItemText primary="CSS Injection" />

            <TextField
              {...textProps}
              value={theme.css_injection ?? ""}
              onChange={handleChange("css_injection")}
            />
          </Item>
        </List>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t("Cancel")}</Button>
        <Button onClick={onSave} variant="contained">
          {t("Save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SettingTheme;
