import { styled } from "@mui/material";
import React from "react";

type Props = {
  label: string;
  fontSize?: string;
  width?: string;
  padding?: string;
  children?: React.ReactNode;
};

export const BaseFieldset: React.FC<Props> = (props: Props) => {
  const Fieldset = styled("div")(() => ({
    position: "relative",
    border: "1px solid #bbb",
    borderRadius: "5px",
    width: props.width ?? "auto",
    padding: props.padding ?? "15px",
  }));

  const Label = styled("legend")(({ theme }) => ({
    position: "absolute",
    top: "-10px",
    left: props.padding ?? "15px",
    backgroundColor: theme.palette.background.paper,
    backgroundImage:
      "linear-gradient(rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.16))",
    color: theme.palette.text.primary,
    fontSize: props.fontSize ?? "1em",
  }));

  return (
    <Fieldset>
      <Label>{props.label}</Label>
      {props.children}
    </Fieldset>
  );
};
