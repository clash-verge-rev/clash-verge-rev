import { CheckRounded, FilterListRounded } from "@mui/icons-material";
import {
  Badge,
  Box,
  Button,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Tooltip,
  Typography,
} from "@mui/material";
import { type ComponentProps, useRef } from "react";

import { BaseSearchBox } from "./base-search-box";
import { BaseStyledTextField } from "./base-styled-text-field";

export type BaseSearchPanelField<T extends string> = {
  key: T;
  label: string;
  count?: number;
};

type BaseSearchBoxProps = ComponentProps<typeof BaseSearchBox>;

type BaseSearchPanelProps<T extends string> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: BaseSearchBoxProps["onSearch"];
  searchBoxProps?: Omit<BaseSearchBoxProps, "onSearch" | "placeholder">;
  searchPlaceholder?: string;
  filterLabel?: string;
  title?: string;
  fields: BaseSearchPanelField<T>[];
  activeField: T;
  onActiveFieldChange: (field: T) => void;
  options: string[];
  isOptionSelected: (option: string) => boolean;
  onToggleOption: (option: string) => void;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  emptyText?: string;
  clearLabel?: string;
  clearDisabled?: boolean;
  onClear?: () => void;
  showIndicator?: boolean;
};

export const BaseSearchPanel = <T extends string>({
  open,
  onOpenChange,
  onSearch,
  searchBoxProps,
  searchPlaceholder,
  filterLabel,
  title,
  fields,
  activeField,
  onActiveFieldChange,
  options,
  isOptionSelected,
  onToggleOption,
  searchValue,
  onSearchValueChange,
  onSearchSubmit,
  emptyText,
  clearLabel,
  clearDisabled,
  onClear,
  showIndicator,
}: BaseSearchPanelProps<T>) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const handleToggleOpen = () => {
    onOpenChange(!open);
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  const anchorWidth = anchorRef.current?.clientWidth;
  const placeholderProps = searchPlaceholder
    ? { placeholder: searchPlaceholder }
    : {};

  return (
    <>
      <Box
        ref={anchorRef}
        sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}
      >
        <Box sx={{ flex: 1 }}>
          <BaseSearchBox
            onSearch={onSearch}
            {...placeholderProps}
            {...searchBoxProps}
          />
        </Box>
        <Tooltip title={filterLabel ?? ""}>
          <Badge
            color="primary"
            variant="dot"
            overlap="circular"
            invisible={!showIndicator}
          >
            <IconButton
              size="small"
              color="inherit"
              onClick={handleToggleOpen}
              aria-label={filterLabel}
              aria-expanded={open}
            >
              <FilterListRounded />
            </IconButton>
          </Badge>
        </Tooltip>
      </Box>
      <Popover
        open={open}
        anchorEl={anchorRef.current}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        PaperProps={{
          sx: {
            mt: 1,
            width: anchorWidth,
            minWidth: 520,
            maxWidth: "90vw",
          },
        }}
      >
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderBottom: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Typography variant="subtitle2">{title}</Typography>
            {onClear && clearLabel ? (
              <Button
                size="small"
                variant="text"
                onClick={onClear}
                disabled={clearDisabled}
              >
                {clearLabel}
              </Button>
            ) : null}
          </Box>
          <Box sx={{ display: "flex", minHeight: 260, maxHeight: 360 }}>
            <Box
              sx={{
                width: 180,
                borderRight: "1px solid",
                borderColor: "divider",
                overflowY: "auto",
              }}
            >
              <List dense disablePadding>
                {fields.map((field) => (
                  <ListItemButton
                    key={field.key}
                    selected={field.key === activeField}
                    onClick={() => onActiveFieldChange(field.key)}
                    sx={{ px: 1.25, py: 0.75 }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        width: "100%",
                        gap: 1,
                      }}
                    >
                      <Typography variant="body2">{field.label}</Typography>
                      {field.count ? (
                        <Box
                          sx={{
                            minWidth: 20,
                            px: 0.5,
                            borderRadius: 1,
                            bgcolor: "action.selected",
                            color: "text.secondary",
                            fontSize: 12,
                            textAlign: "center",
                          }}
                        >
                          {field.count}
                        </Box>
                      ) : null}
                    </Box>
                  </ListItemButton>
                ))}
              </List>
            </Box>
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                }}
              >
                <BaseStyledTextField
                  value={searchValue}
                  {...placeholderProps}
                  onChange={(event) =>
                    onSearchValueChange(event.target.value ?? "")
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !onSearchSubmit) return;
                    event.preventDefault();
                    onSearchSubmit(searchValue);
                  }}
                />
              </Box>
              <Box sx={{ flex: 1, overflowY: "auto" }}>
                {options.length === 0 ? (
                  <Typography
                    variant="body2"
                    sx={{ px: 1.5, py: 2, color: "text.secondary" }}
                  >
                    {emptyText}
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {options.map((option) => {
                      const selected = isOptionSelected(option);
                      return (
                        <ListItemButton
                          key={option}
                          selected={selected}
                          onClick={() => onToggleOption(option)}
                          sx={{ px: 1.5, py: 0.75 }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              width: "100%",
                              gap: 1,
                            }}
                          >
                            <Typography variant="body2" noWrap>
                              {option}
                            </Typography>
                            {selected ? (
                              <CheckRounded
                                fontSize="small"
                                sx={{ color: "primary.main" }}
                              />
                            ) : null}
                          </Box>
                        </ListItemButton>
                      );
                    })}
                  </List>
                )}
              </Box>
            </Box>
          </Box>
        </Box>
      </Popover>
    </>
  );
};
