import { keyframes, styled } from "@mui/material/styles";
import Switch, { switchClasses } from "@mui/material/Switch";

const bailPulse = keyframes`
   0% {
    transform: scale(1);
    opacity: 1;
  }

  50% {
    transform: scale(0.1);
    opacity: 0.6;
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

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
    [`& .${switchClasses.disabled} .${switchClasses.thumb}`]: {
      opacity: "0.3 !important",
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
    [`& .${switchClasses.disabled}+.${switchClasses.track}`]: {
      opacity: "0.3 !important",
    },

    [`[aria-busy=true] .${switchClasses.thumb}::before, [aria-busy=true] .${switchClasses.thumb}::after`]:
      {
        content: '""',
        position: "absolute",
        display: "inline-block",
        width: "10px",
        height: "10px",
        top: "calc(50% - 5px)",
        borderRadius: "100%",
        backgroundColor: theme.palette.primary.main,
      },
    [`[aria-busy=true] .${switchClasses.thumb}::before`]: {
      left: "2px",
      animation: `${bailPulse} infinite 0.75s -0.4s cubic-bezier(0.2, 0.68, 0.18, 1.08)`,
    },
    [`[aria-busy=true] .${switchClasses.thumb}::after`]: {
      left: "10px",
      animation: `${bailPulse} infinite 0.75s cubic-bezier(0.2, 0.68, 0.18, 1.08)`,
    },
    [`[aria-busy=true] .${switchClasses.thumb}`]: {
      boxShadow: "none",
      backgroundColor: "#EADDFF",
      width: size,
      height: size,
    },
    [`[aria-busy=true] + .${switchClasses.track}`]: {
      backgroundColor: "#EADDFF",
      opacity: 1,
      border: "none",
    },
    [`[aria-busy=true].${switchClasses.checked}`]: {
      [`& .${switchClasses.thumb}`]: {
        boxShadow: "none",
        backgroundColor: "#EADDFF",
        width: size,
        height: size,
      },
      [`& + .${switchClasses.track}`]: {
        backgroundColor: "#EADDFF",
        opacity: 1,
        border: "none",
      },
    },
  };
});
