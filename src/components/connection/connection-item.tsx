import dayjs from "dayjs";
import { useLockFn } from "ahooks";
import { styled, ListItem, IconButton, ListItemText } from "@mui/material";
import { CloseRounded } from "@mui/icons-material";
import { ApiType } from "../../services/types";
import { deleteConnection } from "../../services/api";

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

  const onDelete = useLockFn(async () => deleteConnection(value.id));

  return (
    <ListItem
      dense
      secondaryAction={
        <IconButton edge="end" onClick={onDelete}>
          <CloseRounded />
        </IconButton>
      }
    >
      <ListItemText
        primary={value.metadata.host || value.metadata.destinationIP}
        secondary={
          <>
            <Tag sx={{ textTransform: "uppercase", color: "success" }}>
              {value.metadata.network}
            </Tag>

            <Tag>{value.metadata.type}</Tag>

            {value.chains.length > 0 && (
              <Tag>{value.chains[value.chains.length - 1]}</Tag>
            )}

            <Tag>{dayjs(value.start).fromNow()}</Tag>
          </>
        }
      />
    </ListItem>
  );
};

export default ConnectionItem;
