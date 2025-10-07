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
import { useState } from "react";
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
        >
          {value ? (
            <span>
              {value.split(/(%host|%port|%secret)/).map((part) => {
                if (
                  part === "%host" ||
                  part === "%port" ||
                  part === "%secret"
                ) {
                  return <span key={part}>{part}</span>;
                }
                return <span key={part}>{part}</span>;
              })}
            </span>
          ) : (
            "NULL"
          )}
        </Typography>
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
