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

  const placeholderCounts: Record<string, number> = {};
  let textCounter = 0;
  const renderedParts = highlightedParts.map((part) => {
    const isPlaceholder =
      part === "%host" || part === "%port" || part === "%secret";

    if (isPlaceholder) {
      const count = placeholderCounts[part] ?? 0;
      placeholderCounts[part] = count + 1;
      return (
        <span key={`placeholder-${part}-${count}`} className="placeholder">
          {part}
        </span>
      );
    }

    const key = `text-${textCounter}-${part || "empty"}`;
    textCounter += 1;
    return <span key={key}>{part}</span>;
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
