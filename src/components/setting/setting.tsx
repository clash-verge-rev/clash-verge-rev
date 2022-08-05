import React from "react";
import {
  Box,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
} from "@mui/material";

interface ItemProps {
  label: React.ReactNode;
  extra?: React.ReactNode;
}

export const SettingItem: React.FC<ItemProps> = (props) => {
  const { label, extra, children } = props;

  const primary = !extra ? (
    label
  ) : (
    <Box sx={{ display: "flex", alignItems: "center" }}>
      <span style={{ marginRight: 4 }}>{label}</span>
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

export const SettingList: React.FC<{ title: string }> = (props) => (
  <List>
    <ListSubheader sx={{ background: "transparent" }} disableSticky>
      {props.title}
    </ListSubheader>

    {props.children}
  </List>
);
