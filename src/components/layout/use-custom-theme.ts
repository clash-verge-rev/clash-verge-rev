import useSWR from "swr";
import { useMemo } from "react";
import { createTheme } from "@mui/material";
import { getVergeConfig } from "../../services/cmds";

/**
 * wip: custome theme
 */
export default function useCustomTheme() {
  const { data } = useSWR("getVergeConfig", getVergeConfig);
  const mode = data?.theme_mode ?? "light";

  const theme = useMemo(() => {
    // const background = mode === "light" ? "#f5f5f5" : "#000";
    const selectColor = mode === "light" ? "#f5f5f5" : "#d5d5d5";

    const rootEle = document.documentElement;
    rootEle.style.background = "transparent";
    rootEle.style.setProperty("--selection-color", selectColor);

    const theme = createTheme({
      breakpoints: {
        values: { xs: 0, sm: 650, md: 900, lg: 1200, xl: 1536 },
      },
      palette: {
        mode,
        primary: { main: "#5b5c9d" },
        text: { primary: "#637381", secondary: "#909399" },
      },
    });

    const { palette } = theme;

    setTimeout(() => {
      const dom = document.querySelector("#Gradient2");
      if (dom) {
        dom.innerHTML = `
        <stop offset="0%" stop-color="${palette.primary.main}" />
        <stop offset="80%" stop-color="${palette.primary.dark}" />
        <stop offset="100%" stop-color="${palette.primary.dark}" />
        `;
      }
    }, 0);

    return theme;
  }, [mode]);

  return { theme };
}
