import {
  CheckRounded,
  CloseRounded,
  DeleteRounded,
  EditRounded,
  OpenInNewRounded,
} from "@mui/icons-material";
import {
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  value?: string;
  onlyEdit?: boolean;
  onChange: (value?: string) => void;
  onOpenUrl?: (value?: string) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}

export const WebUIItem = (props: Props) => {
  const {
    value,
    onlyEdit = false,
    onChange,
    onDelete,
    onOpenUrl,
    onCancel,
  } = props;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const { t } = useTranslation();

  const highlightedParts = useMemo(() => {
    const placeholderRegex = /(%host|%port|%secret)/g;
    if (!value) {
      return ["NULL"];
    }
    return value.split(placeholderRegex).filter((part) => part !== "");
  }, [value]);

  if (editing || onlyEdit) {
    return (
      <>
        <Stack spacing={0.75} direction="row" mt={1} mb={1} alignItems="center">
          <TextField
            autoComplete="new-password"
            fullWidth
            size="small"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={t(
              "settings.modals.webUI.messages.supportedPlaceholders",
            )}
          />
          <IconButton
            size="small"
            title={t("shared.actions.save")}
            color="inherit"
            onClick={() => {
              onChange(editValue);
              setEditing(false);
            }}
          >
            <CheckRounded fontSize="inherit" />
          </IconButton>
          <IconButton
            size="small"
            title={t("shared.actions.cancel")}
            color="inherit"
            onClick={() => {
              onCancel?.();
              setEditing(false);
            }}
          >
            <CloseRounded fontSize="inherit" />
          </IconButton>
        </Stack>
        <Divider />
      </>
    );
  }

  const renderedParts = highlightedParts.map((part, index) => {
    const isPlaceholder =
      part === "%host" || part === "%port" || part === "%secret";
    const repeatIndex = highlightedParts
      .slice(0, index)
      .filter((prev) => prev === part).length;
    const key = `${part || "empty"}-${repeatIndex}`;

    return (
      <span key={key} className={isPlaceholder ? "placeholder" : undefined}>
        {part}
      </span>
    );
  });

  return (
    <>
      <Stack spacing={0.75} direction="row" alignItems="center" mt={1} mb={1}>
        <Typography
          component="div"
          width="100%"
          title={value}
          color={value ? "text.primary" : "text.secondary"}
          sx={({ palette }) => ({
            overflow: "hidden",
            textOverflow: "ellipsis",
            "> .placeholder": {
              color: palette.primary.main,
            },
          })}
        >
          {renderedParts}
        </Typography>
        <IconButton
          size="small"
          title={t("settings.modals.webUI.actions.openUrl")}
          color="inherit"
          onClick={() => onOpenUrl?.(value)}
        >
          <OpenInNewRounded fontSize="inherit" />
        </IconButton>
        <IconButton
          size="small"
          title={t("shared.actions.edit")}
          color="inherit"
          onClick={() => {
            setEditing(true);
            setEditValue(value);
          }}
        >
          <EditRounded fontSize="inherit" />
        </IconButton>
        <IconButton
          size="small"
          title={t("shared.actions.delete")}
          color="inherit"
          onClick={onDelete}
        >
          <DeleteRounded fontSize="inherit" />
        </IconButton>
      </Stack>
      <Divider />
    </>
  );
};
