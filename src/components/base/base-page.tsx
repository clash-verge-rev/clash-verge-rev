import { Typography } from "@mui/material";
import React from "react";

interface Props {
  title?: React.ReactNode; // the page title
  header?: React.ReactNode; // something behind title
  contentStyle?: React.CSSProperties;
}

const BasePage: React.FC<Props> = (props) => {
  const { title, header, contentStyle, children } = props;

  return (
    <div className="base-page" data-windrag>
      <header data-windrag>
        <Typography variant="h4" component="h1">
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
  );
};

export default BasePage;
