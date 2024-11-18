import { styled, Box } from "@mui/material";

const Item = styled(Box)(({ theme: { palette, typography } }) => ({
  padding: "8px 0",
  margin: "0 12px",
  lineHeight: 1.35,
  borderBottom: `1px solid ${palette.divider}`,
  fontSize: "0.875rem",
  fontFamily: typography.fontFamily,
  userSelect: "text",
  "& .time": {
    color: palette.text.secondary,
  },
  "& .type": {
    display: "inline-block",
    marginLeft: 8,
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
  "& .highlight": {
    backgroundColor: palette.mode === "dark" ? "#ffeb3b40" : "#ffeb3b90",
    borderRadius: 2,
    padding: "0 2px",
  },
}));

interface Props {
  value: ILogItem;
  searchText?: string;
}

const LogItem = ({ value, searchText }: Props) => {
  const renderHighlightText = (text: string) => {
    if (!searchText?.trim()) return text;

    try {
      const parts = text.split(new RegExp(`(${searchText})`, "gi"));
      return parts.map((part, index) =>
        part.toLowerCase() === searchText.toLowerCase() ? (
          <span key={index} className="highlight">
            {part}
          </span>
        ) : (
          part
        ),
      );
    } catch {
      return text;
    }
  };

  return (
    <Item>
      <div>
        <span className="time">{value.time}</span>
        <span className="type" data-type={value.type.toLowerCase()}>
          {value.type}
        </span>
      </div>
      <div>
        <span className="data">{renderHighlightText(value.payload)}</span>
      </div>
    </Item>
  );
};

export default LogItem;
