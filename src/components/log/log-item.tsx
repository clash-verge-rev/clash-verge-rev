import { styled } from "@mui/material";

const Item = styled("div")(({ theme: { palette, typography } }) => ({
  padding: "8px 0",
  margin: "0 12px",
  lineHeight: 1.35,
  // borderBottom: `1px solid ${palette.divider}`,
  fontSize: "0.875rem",
  fontFamily: typography.fontFamily,
  userSelect: "text",
  "& .time": {
    color: palette.text.secondary,
    marginLeft: 8,
  },
  "& .type": {
    display: "inline-block",
    textAlign: "center",
    borderRadius: 2,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  '& .type[data-type="error"], & .type[data-type="err"]': {
    color: palette.error.main,
  },
  '& .type[data-type="warning"], & .type[data-type="warn"]': {
    color: palette.warning.main,
  },
  '& .type[data-type="info"], & .type[data-type="inf"]': {
    color: palette.info.main,
  },
  "& .data": {
    color: palette.text.primary,
    overflowWrap: "anywhere",
  },
}));

interface Props {
  value: ILogItem;
}

const LogItem = (props: Props) => {
  const { value } = props;
  let msg = value.payload;

  msg = msg.replaceAll("-->", " ⇢ ");
  if (value.type.toLowerCase() === "info") {
    msg = msg.replaceAll(" using ", " ⇢ using ");
    msg = msg.replaceAll(" match ", " ⇢ match ");
  }
  msg = msg.replaceAll(" error: ", " ⇢ error ");

  return (
    <Item>
      <div>
        <span className="type" data-type={value.type.toLowerCase()}>
          {value.type}
        </span>
        <span className="time">{value.time}</span>
      </div>
      <div>
        <span className="data">{msg}</span>
      </div>
    </Item>
  );
};

export default LogItem;
