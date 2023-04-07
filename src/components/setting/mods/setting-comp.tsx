import React, { ReactNode } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
} from "@mui/material";

interface ItemProps {
  label: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
}

export const SettingItem: React.FC<ItemProps> = (props) => {
  const { label, extra, children } = props;

  const primary = !extra ? (
    label
  ) : (
    <Box sx={{ display: "flex", alignItems: "center" }}>
      <span>{label}</span>
      {extra}
    </Box>
  );

  return (
    <ListItem sx={{ pt: "5px", pb: "5px" }}>
      <ListItemText primary={primary} />
      {children}
    </ListItem>
  );
};

export const SettingList: React.FC<{
  title: string;
  children: ReactNode;
}> = (props) => (
  <List>
    <ListSubheader sx={{ background: "transparent" }} disableSticky>
      {props.title}
    </ListSubheader>

    {props.children}
  </List>
);
