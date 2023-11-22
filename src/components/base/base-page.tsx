import React, { ReactNode } from "react";
import { Typography } from "@mui/material";
import { BaseErrorBoundary } from "./base-error-boundary";

interface Props {
  title?: React.ReactNode; // the page title
  header?: React.ReactNode; // something behind title
  contentStyle?: React.CSSProperties;
  children?: ReactNode;
}

export const BasePage: React.FC<Props> = (props) => {
  const { title, header, contentStyle, children } = props;

  return (
    <BaseErrorBoundary>
      <div className="base-page" data-windrag>
        <header data-windrag style={{ userSelect: "none" }}>
          <Typography variant="h4" component="h1" data-windrag>
            {title}
          </Typography>

          {header}
        </header>

        <section>
          <div className="base-content" style={contentStyle} data-windrag>
            {children}
          </div>
        </section>
      </div>
    </BaseErrorBoundary>
  );
};
