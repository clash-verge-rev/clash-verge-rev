import { styled } from "@mui/material/styles";
import Switch, { switchClasses } from "@mui/material/Switch";

// const pxToRem = (px: number, oneRemPx = 21) => `${px}px`;
export const SwitchLovely = styled(Switch)(({ theme }) => {
  const borderWidth = 2;
  const width = 42;
  const height = 26;
  const size = 18;
  const gap = (height - size) / 2;
  const checkedX = width - size - 2 * gap;
  return {
    width,
    height,
    padding: 0,
    // margin: theme.spacing(1),
    margin: 2,
    [`& .${switchClasses.switchBase}`]: {
      padding: gap,
      [`&.${switchClasses.checked}`]: {
        color: "#fff",
        transform: `translateX(calc(${checkedX}px))`,
        [`& + .${switchClasses.track}`]: {
          backgroundColor: theme.palette.primary.main,
          opacity: 1,
          border: "none",
        },
        [`& .${switchClasses.thumb}`]: {
          backgroundColor: "#fff",
        },
      },
    },
    [`& .${switchClasses.thumb}`]: {
      boxShadow: "none",
      backgroundColor: theme.palette.grey[400],
      width: size,
      height: size,
    },
    [`& .${switchClasses.track}`]: {
      borderRadius: 40,
      border: `solid ${theme.palette.grey[400]}`,
      borderWidth,
      backgroundColor: theme.palette.mode === "light" ? "#E9E9EA" : "#39393D",
      opacity: 1,
      transition: theme.transitions.create(["background-color", "border"]),
      boxSizing: "border-box",
    },
  };
});
