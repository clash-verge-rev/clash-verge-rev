import { styled, Box } from "@mui/material";

const Item = styled(Box)(({ theme }) => ({
  padding: "8px 0",
  margin: "0 12px",
  lineHeight: 1.35,
  borderBottom: `1px solid ${theme.palette.divider}`,
  fontSize: "0.875rem",
  userSelect: "text",
  "& .time": {},
  "& .type": {
    display: "inline-block",
    padding: "0 6px",
    textAlign: "center",
    borderRadius: 2,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  "& .data": {},
}));

interface Props {
  value: ApiType.LogItem;
}

const LogItem = (props: Props) => {
  const { value } = props;

  return (
    <Item>
      <span className="time">{value.time}</span>
      <span className="type">{value.type}</span>
      <span className="data">{value.payload}</span>
    </Item>
  );
};

export default LogItem;
