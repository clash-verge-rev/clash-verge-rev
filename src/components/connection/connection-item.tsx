import dayjs from "dayjs";
import { useLockFn } from "ahooks";
import {
  styled,
  ListItem,
  IconButton,
  ListItemText,
  Box,
  alpha,
  Typography,
} from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import { deleteConnection } from "@/services/api";
import parseTraffic from "@/utils/parse-traffic";
import { useTranslation } from "react-i18next";

const Tag = styled("span")(({ theme }) => ({
  fontSize: "10px",
  padding: "0 4px",
  lineHeight: 1.375,
  border: "1px solid",
  borderRadius: 4,
  borderColor: alpha(theme.palette.text.secondary, 0.35),
  marginTop: "4px",
  marginRight: "4px",
}));

const StatusTag = styled("span", {
  shouldForwardProp: (prop) => prop !== "active",
})<{
  active: boolean;
}>(({ theme, active }) => ({
  fontSize: "10px",
  padding: "0 4px",
  lineHeight: 1.375,
  border: "1px solid",
  borderRadius: 4,
  borderColor: active
    ? theme.palette.success.main
    : alpha(theme.palette.text.secondary, 0.35),
  color: active ? theme.palette.success.main : theme.palette.text.secondary,
  background: "none",
  marginTop: "4px",
  marginRight: "4px",
  fontWeight: 500,
  transition: "all 0.2s",
}));

interface Props {
  value: IConnectionsItem;
  onShowDetail?: () => void;
}

export const ConnectionItem = (props: Props) => {
  const { value, onShowDetail } = props;
  const { t } = useTranslation();

  const { id, metadata, chains, start, curUpload, curDownload } = value;

  const onDelete = useLockFn(async () => deleteConnection(id));
  const showTraffic = curUpload! >= 100 || curDownload! >= 100;

  const isActive =
    (typeof curUpload === "number" && curUpload > 0) ||
    (typeof curDownload === "number" && curDownload > 0);

  return (
    <ListItem
      dense
      sx={{ borderBottom: "1px solid var(--divider-color)" }}
      secondaryAction={
        <IconButton edge="end" color="inherit" onClick={onDelete}>
          <CloseRounded />
        </IconButton>
      }
    >
      <ListItemText
        sx={{ userSelect: "text", cursor: "pointer" }}
        primary={
          <Box display="flex" alignItems="center" gap={1}>
            <StatusTag active={isActive}>
              {isActive ? t("活动") : t("未活动")}
            </StatusTag>
            <Tag>
              {parseTraffic(value.download ?? 0)}↓ /{" "}
              {parseTraffic(value.upload ?? 0)}↑
            </Tag>
            <Typography variant="body1" sx={{ wordBreak: "break-all" }}>
              {metadata.host || metadata.destinationIP}
            </Typography>
          </Box>
        }
        onClick={onShowDetail}
        secondary={
          <Box sx={{ display: "flex", flexWrap: "wrap" }}>
            <Tag sx={{ textTransform: "uppercase", color: "success" }}>
              {metadata.network}
            </Tag>
            <Tag>{metadata.type}</Tag>
            {!!metadata.process && <Tag>{metadata.process}</Tag>}
            {chains?.length > 0 && (
              <Tag>{[...chains].reverse().join(" / ")}</Tag>
            )}
            <Tag>{dayjs(start).fromNow()}</Tag>
            {showTraffic && (
              <Tag>
                {parseTraffic(curUpload ?? 0)} /{" "}
                {parseTraffic(curDownload ?? 0)}
              </Tag>
            )}
          </Box>
        }
      />
    </ListItem>
  );
};
