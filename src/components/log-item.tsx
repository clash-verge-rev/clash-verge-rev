import { styled, Box } from "@mui/material";

const LogItem = styled(Box)(({ theme }) => ({
  padding: "8px 0",
  margin: "0 12px",
  lineHeight: 1.35,
  borderBottom: `1px solid ${theme.palette.divider}`,
  "& .time": {},
  "& .type": {
    display: "inline-block",
    width: 50,
    margin: "0 4px",
    textAlign: "center",
    borderRadius: 2,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  "& .data": {},
}));

export default LogItem;
