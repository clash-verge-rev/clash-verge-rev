import React, { ReactNode } from "react";
import { Typography, alpha } from "@mui/material";
import { BaseErrorBoundary } from "./base-error-boundary";
import { useCustomTheme } from "@/components/layout/use-custom-theme";

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
        <header data-windrag style={{ userSelect: "none" }}>
          <Typography variant="h4" component="h1" data-windrag>
            {title}
          </Typography>

          {header}
        </header>

        <div
          className={full ? "base-container no-padding" : "base-container"}
          style={{ backgroundColor: isDark ? "#090909" : "#ffffff" }}
        >
          <section
            style={{
              backgroundColor: isDark
                ? alpha(theme.palette.primary.main, 0.1)
                : "",
            }}
          >
            <div className="base-content" style={contentStyle}>
              {children}
            </div>
          </section>
        </div>
      </div>
    </BaseErrorBoundary>
  );
};
