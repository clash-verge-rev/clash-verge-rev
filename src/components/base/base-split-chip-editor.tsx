import { CodeRounded, ViewModuleRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  FormHelperText,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export type BaseSplitChipEditorMode = "visual" | "advanced";

interface BaseSplitChipEditorProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  helperText?: ReactNode;
  placeholder?: string;
  rows?: number;
  separator?: string;
  splitPattern?: RegExp;
  defaultMode?: BaseSplitChipEditorMode;
  showModeToggle?: boolean;
  ariaLabel?: string;
  addLabel?: ReactNode;
  emptyLabel?: ReactNode;
  modeLabels?: Partial<Record<BaseSplitChipEditorMode, ReactNode>>;
  renderHeader?: (modeToggle: ReactNode) => ReactNode;
}

const DEFAULT_SPLIT_PATTERN = /[,\n;\r]+/;

const splitValue = (value: string, splitPattern: RegExp) =>
  value
    .split(splitPattern)
    .map((item) => item.trim())
    .filter(Boolean);

export const BaseSplitChipEditor = ({
  value = "",
  onChange,
  disabled = false,
  error = false,
  helperText,
  placeholder,
  rows = 4,
  separator = ",",
  splitPattern = DEFAULT_SPLIT_PATTERN,
  defaultMode = "visual",
  showModeToggle = true,
  ariaLabel,
  addLabel,
  emptyLabel,
  modeLabels,
  renderHeader,
}: BaseSplitChipEditorProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<BaseSplitChipEditorMode>(defaultMode);
  const [draft, setDraft] = useState("");

  const resolvedLabels = useMemo(
    () => ({
      visual: modeLabels?.visual ?? t("shared.editorModes.visualization"),
      advanced: modeLabels?.advanced ?? t("shared.editorModes.advanced"),
      add: addLabel ?? t("shared.actions.new"),
      empty: emptyLabel ?? t("shared.statuses.empty"),
    }),
    [t, modeLabels, addLabel, emptyLabel],
  );

  const values = useMemo(
    () => splitValue(value, splitPattern),
    [value, splitPattern],
  );

  const items = useMemo(() => {
    const counts = new Map<string, number>();
    return values.map((item) => {
      const nextCount = (counts.get(item) ?? 0) + 1;
      counts.set(item, nextCount);
      return {
        key: `${item}-${nextCount}`,
        value: item,
      };
    });
  }, [values]);

  const handleAddDraft = () => {
    const nextValues = splitValue(draft, splitPattern);
    if (!nextValues.length) {
      return;
    }
    const nextValue = [...values, ...nextValues].join(separator);
    onChange(nextValue);
    setDraft("");
  };

  const handleRemoveItem = (index: number) => {
    const nextValue = values.filter((_, itemIndex) => itemIndex !== index);
    onChange(nextValue.join(separator));
  };

  const nextMode = mode === "visual" ? "advanced" : "visual";
  const toggleLabel =
    nextMode === "visual" ? resolvedLabels.visual : resolvedLabels.advanced;
  const ToggleIcon = nextMode === "visual" ? ViewModuleRounded : CodeRounded;
  const resolvedAriaLabel =
    ariaLabel ?? (typeof toggleLabel === "string" ? toggleLabel : undefined);

  const modeToggle = showModeToggle ? (
    <Tooltip title={toggleLabel}>
      <IconButton
        size="small"
        aria-label={resolvedAriaLabel}
        onClick={() => {
          setMode(nextMode);
          if (nextMode === "visual") {
            setDraft("");
          }
        }}
      >
        <ToggleIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  ) : null;

  return (
    <>
      {renderHeader ? renderHeader(modeToggle) : modeToggle}
      {mode === "visual" ? (
        <Box sx={{ padding: "0 2px 5px" }}>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              minHeight: 32,
            }}
          >
            {items.length ? (
              items.map((item, index) => (
                <Chip
                  key={item.key}
                  label={item.value}
                  size="small"
                  onDelete={
                    disabled ? undefined : () => handleRemoveItem(index)
                  }
                />
              ))
            ) : (
              <Typography variant="body2" color="text.secondary">
                {resolvedLabels.empty}
              </Typography>
            )}
          </Box>
          <Box
            sx={{ display: "flex", gap: 1, marginTop: 1, alignItems: "center" }}
          >
            <TextField
              disabled={disabled}
              size="small"
              fullWidth
              value={draft}
              placeholder={placeholder}
              error={error}
              sx={{
                "& .MuiInputBase-root": { minHeight: 32 },
                "& .MuiInputBase-input": { padding: "4px 8px" },
              }}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddDraft();
                }
              }}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={handleAddDraft}
              disabled={disabled || !draft.trim()}
              sx={{ minHeight: 32, padding: "2px 8px" }}
            >
              {resolvedLabels.add}
            </Button>
          </Box>
          {helperText && (
            <FormHelperText error={error}>{helperText}</FormHelperText>
          )}
        </Box>
      ) : (
        <TextField
          error={error}
          disabled={disabled}
          size="small"
          multiline
          rows={rows}
          sx={{ width: "100%" }}
          value={value}
          helperText={helperText}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </>
  );
};
