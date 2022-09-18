import { styled, Box, Typography } from "@mui/material";

const Item = styled(Box)(({ theme }) => ({
  display: "flex",
  padding: "6px 16px",
  color: theme.palette.text.primary,
  marginBottom: "6px",
}));

const COLOR = [
  "primary",
  "secondary",
  "info",
  "warning",
  "error",
  "success",
  "text",
];

interface Props {
  index: number;
  value: ApiType.RuleItem;
}

const parseColor = (text: string) => {
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    sum += text.charCodeAt(i);
  }
  return COLOR[sum % COLOR.length];
};

const RuleItem = (props: Props) => {
  const { index, value } = props;

  return (
    <Item>
      <Typography
        color="text.secondary"
        variant="body2"
        sx={{ lineHeight: 2, minWidth: 30, mr: 2.25, textAlign: "center" }}
      >
        {index}
      </Typography>

      <Box>
        <Typography component="h6" variant="subtitle1" color="text.primary">
          {value.payload || "-"}
        </Typography>

        <Typography
          component="span"
          variant="body2"
          color="text.secondary"
          sx={{ mr: 3, minWidth: 120, display: "inline-block" }}
        >
          {value.type}
        </Typography>

        <Typography
          component="span"
          variant="body2"
          color={parseColor(value.proxy)}
        >
          {value.proxy}
        </Typography>
      </Box>
    </Item>
  );
};

export default RuleItem;
