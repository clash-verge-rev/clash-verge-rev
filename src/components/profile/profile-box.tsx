import { alpha, styled } from "@mui/material";

export const ProfileDiv = styled("div")(({
  theme,
  "aria-selected": selected,
}) => {
  const { mode, primary, text } = theme.palette;
  const key = `${mode}-${!!selected}`;

  const unselectedbackgroundColor = mode === "light" ? "#ffffff" : "#282A36";
  const selectedBackgroundColor =
    mode === "light" ? alpha(primary.main, 0.25) : alpha(primary.main, 0.35);

  const color = {
    "light-true": text.secondary,
    "light-false": text.secondary,
    "dark-true": alpha(text.secondary, 0.65),
    "dark-false": alpha(text.secondary, 0.65),
  }[key];

  const h2color = {
    "light-true": primary.main,
    "light-false": text.primary,
    "dark-true": primary.main,
    "dark-false": text.primary,
  }[key];

  const borderSelect = {
    "light-true": {
      borderLeft: `3px solid ${primary.main}`,
      width: "100%",
      // marginLeft: `-3px`,
    },
    "light-false": {
      width: "100%",
    },
    "dark-true": {
      borderLeft: `3px solid ${primary.main}`,
      width: "100%",
      // marginLeft: `-3px`,
    },
    "dark-false": {
      width: "100%",
    },
  }[key];

  return {
    position: "relative",
    display: "block",
    width: "100%",
    height: "100%",
    cursor: "pointer",
    textAlign: "left",
    padding: "8px 16px",
    boxSizing: "border-box",
    backgroundColor: selected
      ? `${selectedBackgroundColor} !important`
      : unselectedbackgroundColor,
    ...borderSelect,
    borderRadius: "8px",
    color,
    overflow: "hidden",
    "& h2": { color: h2color },
  };
});
