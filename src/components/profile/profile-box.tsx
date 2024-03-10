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

    const borderSelect = {
      "light-true": {
        borderLeft: `3px solid ${primary.main}`,
        width: `calc(100% + 3px)`,
        marginLeft: `-3px`,
      },
      "light-false": {
        width: "100%",
      },
      "dark-true": {
        borderLeft: `3px solid ${primary.main}`,
        width: `calc(100% + 3px)`,
        marginLeft: `-3px`,
      },
      "dark-false": {
        width: "100%",
      },
    }[key];

    return {
      position: "relative",
      display: "block",
      cursor: "pointer",
      textAlign: "left",
      padding: "8px 16px",
      boxSizing: "border-box",
      backgroundColor,
      ...borderSelect,
      borderRadius: "8px",
      color,
      "& h2": { color: h2color },
    };
  }
);
