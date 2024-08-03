import dayjs from "dayjs";
import { useLockFn } from "ahooks";
import {
  styled,
  ListItem,
  IconButton,
  ListItemText,
  Box,
  alpha,
} from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import { deleteConnection } from "@/services/api";
import parseTraffic from "@/utils/parse-traffic";

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

interface Props {
  value: IConnectionsItem;
  onShowDetail?: () => void;
}

export const ConnectionItem = (props: Props) => {
  const { value, onShowDetail } = props;

  const { id, metadata, chains, start, curUpload, curDownload } = value;

  const onDelete = useLockFn(async () => deleteConnection(id));
  const showTraffic = curUpload! >= 100 || curDownload! >= 100;

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
        primary={metadata.host || metadata.destinationIP}
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
                {parseTraffic(curUpload!)} / {parseTraffic(curDownload!)}
              </Tag>
            )}
          </Box>
        }
      />
    </ListItem>
  );
};
