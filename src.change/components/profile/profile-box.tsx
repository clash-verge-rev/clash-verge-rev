import { NoEncryption } from "@mui/icons-material";
import { alpha, Box, styled } from "@mui/material";

export const ProfileBox = styled(Box)(
  ({ theme, "aria-selected": selected }) => {
    const { mode, primary, text, grey, background } = theme.palette;
    const key = `${mode}-${!!selected}`;

    const backgroundColor = {
      "light-true": "#f5f5f5",
      "light-false": "#f5f5f5",
      "dark-true": alpha(primary.main, 0.45),
      "dark-false": alpha(grey[700], 0.45),
    }[key]!;

    const color = {
      "light-true": text.primary,
      "light-false": text.primary,
      "dark-true": alpha(text.secondary, 0.85),
      "dark-false": alpha(text.secondary, 0.65),
    }[key]!;

    const h2color = {
      "light-true": primary.main,
      "light-false": text.primary,
      "dark-true": primary.light,
      "dark-false": text.primary,
    }[key]!;

    const borderLeft = {
      "light-true": "4px solid #63d170",
      "light-false": "",
      "dark-true": "",
      "dark-false": "",
    }[key]!;

    return {
      position: "relative",
      width: "100%",
      display: "block",
      cursor: "pointer",
      textAlign: "left",
      borderRadius: "8px",
      // boxShadow: theme.shadows[0],
      padding: "8px 16px 16px 16px",
      boxSizing: "border-box",
      backgroundColor,
      borderLeft,
      color,
      "& h2": { color: h2color },
    };
  }
);
