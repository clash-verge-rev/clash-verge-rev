import { alpha, Box, styled } from "@mui/material";

export const ProfileBox = styled(Box)(
  ({ theme, "aria-selected": selected }) => {
    const { mode, primary, text, grey, background } = theme.palette;
    const key = `${mode}-${!!selected}`;

    const backgroundColor = {
      "light-true": "#ffffff",
      "light-false": "#ffffff",
      "dark-true": "#44475a",
      "dark-false": "#44475a",
    }[key]!;

    const color = {
      "light-true": text.primary,
      "light-false": text.primary,
      "dark-true": text.primary,
      "dark-false": text.primary,
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
      padding: "8px 16px",
      boxSizing: "border-box",
      backgroundColor,
      borderRadius: "8px",
      color,
      "& h2": { color: h2color },
    };
  }
);
