import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { Typography } from "@mui/material";
import React, { ReactNode } from "react";
import { BaseErrorBoundary } from "./base-error-boundary";

interface Props {
  title?: React.ReactNode; // the page title
  header?: React.ReactNode; // something behind title
  contentStyle?: React.CSSProperties;
  children?: ReactNode;
  full?: boolean;
}

export const BasePage: React.FC<Props> = (props) => {
  const { title, header, contentStyle, full, children } = props;
  const { theme } = useCustomTheme();

  const isDark = theme.palette.mode === "dark";

  return (
    <BaseErrorBoundary>
      <div className="base-page">
        <div
          className="base-header"
          data-tauri-drag-region="true"
          style={{ userSelect: "none" }}>
          <Typography
            sx={{ fontSize: "20px", fontWeight: "700 " }}
            data-tauri-drag-region="true">
            {title}
          </Typography>

          {header}
        </div>

        <div
          className={full ? "base-container no-padding" : "base-container"}
          style={{ backgroundColor: isDark ? "#1e1f27" : "#ffffff" }}>
          <div
            className="base-section"
            style={{
              backgroundColor: isDark ? "#1e1f27" : "var(--background-color)",
            }}>
            <div className="base-content" style={contentStyle}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </BaseErrorBoundary>
  );
};
