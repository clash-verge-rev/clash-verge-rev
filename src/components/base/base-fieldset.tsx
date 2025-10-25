import { Box, styled } from "@mui/material";
import React from "react";

type Props = {
  label: string;
  fontSize?: string;
  width?: string;
  padding?: string;
  children?: React.ReactNode;
};

export const BaseFieldset: React.FC<Props> = ({
  label,
  fontSize,
  width,
  padding,
  children,
}: Props) => {
  const Fieldset = styled(Box)<{ component?: string }>(() => ({
    position: "relative",
    border: "1px solid #bbb",
    borderRadius: "5px",
    width: width ?? "auto",
    padding: padding ?? "15px",
  }));

  const Label = styled("legend")(({ theme }) => ({
    position: "absolute",
    top: "-10px",
    left: padding ?? "15px",
    backgroundColor: theme.palette.background.paper,
    backgroundImage:
      "linear-gradient(rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.16))",
    color: theme.palette.text.primary,
    fontSize: fontSize ?? "1em",
  }));

  return (
    <Fieldset component="fieldset">
      <Label>{label}</Label>
      {children}
    </Fieldset>
  );
};
