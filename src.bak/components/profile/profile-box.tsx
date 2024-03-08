import { alpha, Box, styled } from "@mui/material";

export const ProfileBox = styled(Box)(
  ({ theme, "aria-selected": selected }) => {
    const { mode, primary, text, grey, background } = theme.palette;
    const key = `${mode}-${!!selected}`;

    const backgroundColor = {
      "light-true": alpha(primary.main, 0.2),
      "light-false": alpha(background.paper, 0.75),
      "dark-true": alpha(primary.main, 0.45),
      "dark-false": alpha(grey[700], 0.45),
    }[key]!;

    const color = {
      "light-true": text.secondary,
      "light-false": text.secondary,
      "dark-true": alpha(text.secondary, 0.85),
      "dark-false": alpha(text.secondary, 0.65),
    }[key]!;

    const h2color = {
      "light-true": primary.main,
      "light-false": text.primary,
      "dark-true": primary.light,
      "dark-false": text.primary,
    }[key]!;

    return {
      position: "relative",
      width: "100%",
      display: "block",
      cursor: "pointer",
      textAlign: "left",
      borderRadius: theme.shape.borderRadius,
      boxShadow: theme.shadows[2],
      padding: "8px 16px",
      boxSizing: "border-box",
      backgroundColor,
      color,
      "& h2": { color: h2color },
    };
  }
);
