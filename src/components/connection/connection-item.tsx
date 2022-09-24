import dayjs from "dayjs";
import { useLockFn } from "ahooks";
import { styled, ListItem, IconButton, ListItemText } from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import { deleteConnection } from "@/services/api";
import parseTraffic from "@/utils/parse-traffic";

const Tag = styled("span")(({ theme }) => ({
  display: "inline-block",
  fontSize: "12px",
  padding: "0 4px",
  lineHeight: 1.375,
  border: "1px solid #ccc",
  borderRadius: 4,
  marginRight: "0.1em",
  transform: "scale(0.92)",
}));

interface Props {
  value: ApiType.ConnectionsItem;
}

const ConnectionItem = (props: Props) => {
  const { value } = props;

  const { id, metadata, chains, start, curUpload, curDownload } = value;

  const onDelete = useLockFn(async () => deleteConnection(id));
  const showTraffic = curUpload! > 1024 || curDownload! > 1024;

  return (
    <ListItem
      dense
      secondaryAction={
        <IconButton edge="end" color="inherit" onClick={onDelete}>
          <CloseRounded />
        </IconButton>
      }
    >
      <ListItemText
        sx={{ userSelect: "text" }}
        primary={metadata.host || metadata.destinationIP}
        secondary={
          <>
            <Tag sx={{ textTransform: "uppercase", color: "success" }}>
              {metadata.network}
            </Tag>

            <Tag>{metadata.type}</Tag>

            {metadata.process && <Tag>{metadata.process}</Tag>}

            {chains.length > 0 && <Tag>{chains[value.chains.length - 1]}</Tag>}

            {chains.length > 0 && <Tag>{chains[0]}</Tag>}

            <Tag>{dayjs(start).fromNow()}</Tag>

            {showTraffic && (
              <Tag>
                {parseTraffic(curUpload!)} / {parseTraffic(curDownload!)}
              </Tag>
            )}
          </>
        }
      />
    </ListItem>
  );
};

export default ConnectionItem;
