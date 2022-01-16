import React from "react";
import { List, ListItem, ListSubheader, styled } from "@mui/material";

export const SettingItem = styled(ListItem)(() => ({
  paddingTop: 5,
  paddingBottom: 5,
}));

export const SettingList: React.FC<{ title: string }> = (props) => (
  <List>
    <ListSubheader sx={{ background: "transparent" }} disableSticky>
      {props.title}
    </ListSubheader>

    {props.children}
  </List>
);
