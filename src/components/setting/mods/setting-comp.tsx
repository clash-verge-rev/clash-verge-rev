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
  secondary?: ReactNode;
}

export const SettingItem: React.FC<ItemProps> = (props) => {
  const { label, extra, children, secondary } = props;

  const primary = !extra ? (
    <Box sx={{ display: "flex", alignItems: "center", fontSize: "14px" }}>
      <span>{label}</span>
    </Box>
  ) : (
    <Box sx={{ display: "flex", alignItems: "center", fontSize: "14px" }}>
      <span>{label}</span>
      {extra}
    </Box>
  );

  return (
    <ListItem sx={{ pt: "5px", pb: "5px" }}>
      <ListItemText primary={primary} secondary={secondary} />
      {children}
    </ListItem>
  );
};

export const SettingList: React.FC<{
  title: string;
  children: ReactNode;
}> = (props) => (
  <List>
    <ListSubheader
      sx={[
        { background: "transparent", fontSize: "16px", fontWeight: "700" },
        ({ palette }) => {
          return {
            color: palette.text.primary,
          };
        },
      ]}
      disableSticky
    >
      {props.title}
    </ListSubheader>

    {props.children}
  </List>
);
