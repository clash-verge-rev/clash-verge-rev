import { cn } from "@/utils";
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

  return (
    <BaseErrorBoundary>
      <div className="h-full w-full">
        <div
          className="flex h-[50px] items-center justify-between px-2"
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
          className={"h-[calc(100%-50px)] w-full bg-white dark:bg-[#1e1f27]"}>
          <div
            className={cn(
              "bg-comment h-full w-full overflow-auto px-2 dark:bg-[#1e1f27]",
              { "p-0": full },
            )}
            style={contentStyle}>
            {children}
          </div>
        </div>
      </div>
    </BaseErrorBoundary>
  );
};
