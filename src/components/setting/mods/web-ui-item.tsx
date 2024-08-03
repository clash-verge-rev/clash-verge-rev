import { useState } from "react";
import {
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  CheckRounded,
  CloseRounded,
  DeleteRounded,
  EditRounded,
  OpenInNewRounded,
} from "@mui/icons-material";
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
            placeholder={t("Support %host, %port, %secret")}
          />
          <IconButton
            size="small"
            title={t("Save")}
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
            title={t("Cancel")}
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

  const html = value
    ?.replace("%host", "<span>%host</span>")
    .replace("%port", "<span>%port</span>")
    .replace("%secret", "<span>%secret</span>");

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
            "> span": {
              color: palette.primary.main,
            },
          })}
          dangerouslySetInnerHTML={{ __html: html || "NULL" }}
        />
        <IconButton
          size="small"
          title={t("Open URL")}
          color="inherit"
          onClick={() => onOpenUrl?.(value)}
        >
          <OpenInNewRounded fontSize="inherit" />
        </IconButton>
        <IconButton
          size="small"
          title={t("Edit")}
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
          title={t("Delete")}
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
