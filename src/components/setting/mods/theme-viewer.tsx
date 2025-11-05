import { EditRounded } from "@mui/icons-material";
import {
  Button,
  List,
  ListItem,
  ListItemText,
  styled,
  TextField,
  useTheme,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { useImperativeHandle, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { BaseDialog, DialogRef } from "@/components/base";
import { EditorViewer } from "@/components/profile/editor-viewer";
import { useVerge } from "@/hooks/use-verge";
import { defaultDarkTheme, defaultTheme } from "@/pages/_theme";
import { showNotice } from "@/services/noticeService";

export function ThemeViewer(props: { ref?: React.Ref<DialogRef> }) {
  const { ref } = props;
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const { verge, patchVerge } = useVerge();
  const { theme_setting } = verge ?? {};
  const [theme, setTheme] = useState(theme_setting || {});

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true);
      setTheme({ ...theme_setting });
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

  const onSave = useLockFn(async () => {
    try {
      await patchVerge({ theme_setting: theme });
      setOpen(false);
    } catch (err) {
      showNotice.error(err);
    }
  });

  // default theme
  const { palette } = useTheme();

  const dt = palette.mode === "light" ? defaultTheme : defaultDarkTheme;

  type ThemeKey = keyof typeof theme & keyof typeof defaultTheme;

  const fieldDefinitions: Array<{ labelKey: string; key: ThemeKey }> = useMemo(
    () => [
      {
        labelKey: "settings.components.verge.theme.fields.primaryColor",
        key: "primary_color",
      },
      {
        labelKey: "settings.components.verge.theme.fields.secondaryColor",
        key: "secondary_color",
      },
      {
        labelKey: "settings.components.verge.theme.fields.primaryText",
        key: "primary_text",
      },
      {
        labelKey: "settings.components.verge.theme.fields.secondaryText",
        key: "secondary_text",
      },
      {
        labelKey: "settings.components.verge.theme.fields.infoColor",
        key: "info_color",
      },
      {
        labelKey: "settings.components.verge.theme.fields.warningColor",
        key: "warning_color",
      },
      {
        labelKey: "settings.components.verge.theme.fields.errorColor",
        key: "error_color",
      },
      {
        labelKey: "settings.components.verge.theme.fields.successColor",
        key: "success_color",
      },
    ],
    [],
  );

  const renderItem = (labelKey: string, key: ThemeKey) => {
    const label = t(labelKey);
    return (
      <Item key={key}>
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
      title={t("settings.components.verge.theme.title")}
      okBtn={t("shared.actions.save")}
      cancelBtn={t("shared.actions.cancel")}
      contentSx={{ width: 400, maxHeight: 505, overflow: "auto", pb: 0 }}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List sx={{ pt: 0 }}>
        {fieldDefinitions.map((field) => renderItem(field.labelKey, field.key))}

        <Item>
          <ListItemText
            primary={t("settings.components.verge.theme.fields.fontFamily")}
          />
          <TextField
            {...textProps}
            value={theme.font_family ?? ""}
            onChange={handleChange("font_family")}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
          />
        </Item>
        <Item>
          <ListItemText
            primary={t("settings.components.verge.theme.fields.cssInjection")}
          />
          <Button
            startIcon={<EditRounded />}
            variant="outlined"
            onClick={() => {
              setEditorOpen(true);
            }}
          >
            {t("settings.components.verge.theme.actions.editCss")}
          </Button>
          {editorOpen && (
            <EditorViewer
              open={true}
              title={t("settings.components.verge.theme.dialogs.editCssTitle")}
              initialData={Promise.resolve(theme.css_injection ?? "")}
              language="css"
              onSave={(_prev, curr) => {
                theme.css_injection = curr;
                handleChange("css_injection");
              }}
              onClose={() => {
                setEditorOpen(false);
              }}
            />
          )}
        </Item>
      </List>
    </BaseDialog>
  );
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
