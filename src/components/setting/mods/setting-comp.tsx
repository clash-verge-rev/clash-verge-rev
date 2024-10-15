import isAsyncFunction from "@/utils/is-async-function";
import { ChevronRightRounded } from "@mui/icons-material";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
} from "@mui/material";
import CircularProgress from "@mui/material/CircularProgress";
import React, { ReactNode, useState } from "react";

interface ItemProps {
  label: ReactNode;
  disabled?: boolean;
  expand?: boolean;
  extra?: ReactNode;
  children?: ReactNode;
  secondary?: ReactNode;
  onClick?: () => void | Promise<any>;
}

export const SettingItem: React.FC<ItemProps> = (props) => {
  const { label, expand, disabled, extra, children, secondary, onClick } =
    props;
  const clickable = !!onClick;

  const primary = (
    <Box sx={{ display: "flex", alignItems: "center", fontSize: "14px" }}>
      <span>{label}</span>
      {extra ? extra : null}
    </Box>
  );

  const [isLoading, setIsLoading] = useState(false);
  const handleClick = () => {
    if (onClick) {
      if (isAsyncFunction(onClick)) {
        setIsLoading(true);
        onClick()!.finally(() => setIsLoading(false));
      } else {
        onClick();
      }
    }
  };

  return clickable ? (
    <ListItem
      disablePadding
      sx={{ ...(expand && { bgcolor: "var(--background-color-alpha)" }) }}>
      <ListItemButton onClick={handleClick} disabled={isLoading || disabled}>
        <ListItemText primary={primary} secondary={secondary} />
        {isLoading ? (
          <CircularProgress color="inherit" size={20} />
        ) : (
          <ChevronRightRounded
            sx={{
              transform: expand ? "rotate(90deg)" : "rotate(0)",
              transition: "all 0.2s",
            }}
          />
        )}
      </ListItemButton>
    </ListItem>
  ) : (
    <ListItem sx={{ pt: "5px", pb: "5px" }}>
      <ListItemText
        primary={primary}
        secondary={secondary}
        sx={{ opacity: disabled ? 0.5 : 1 }}
      />
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
      key={props.title}
      sx={[
        { background: "transparent", fontSize: "16px", fontWeight: "700" },
        ({ palette }) => {
          return {
            color: palette.text.primary,
          };
        },
      ]}
      disableSticky>
      {props.title}
    </ListSubheader>

    {props.children}
  </List>
);
