import { alpha, Box, styled } from "@mui/material";

export const ProfileBox = styled(Box)(
  ({ theme, "aria-selected": selected }) => {
    const { mode, primary, text } = theme.palette;
    const key = `${mode}-${!!selected}`;

    const backgroundColor = mode === "light" ? "#ffffff" : "#282A36";

    const color = {
      "light-true": text.secondary,
      "light-false": text.secondary,
      "dark-true": alpha(text.secondary, 0.65),
      "dark-false": alpha(text.secondary, 0.65),
    }[key]!;

    const h2color = {
      "light-true": primary.main,
      "light-false": text.primary,
      "dark-true": primary.main,
      "dark-false": text.primary,
    }[key]!;

    const borderLeft = {
      "light-true": `3px solid ${primary.main}`,
      "light-false": "none",
      "dark-true": `3px solid ${primary.main}`,
      "dark-false": "none",
    }[key];

    return {
      position: "relative",
      width: "100%",
      display: "block",
      cursor: "pointer",
      textAlign: "left",
      borderLeft,
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
