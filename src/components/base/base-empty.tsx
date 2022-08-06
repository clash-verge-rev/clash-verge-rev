import { alpha, Box, Typography } from "@mui/material";
import { BlurOnRounded } from "@mui/icons-material";

interface Props {
  text?: React.ReactNode;
  extra?: React.ReactNode;
}

const BaseEmpty = (props: Props) => {
  const { text = "Empty", extra } = props;

  return (
    <Box
      sx={({ palette }) => ({
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: alpha(palette.text.secondary, 0.75),
      })}
    >
      <BlurOnRounded sx={{ fontSize: "4em" }} />
      <Typography sx={{ fontSize: "1.25em" }}>{text}</Typography>
      {extra}
    </Box>
  );
};

export default BaseEmpty;
