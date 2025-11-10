import { Box, SvgIcon, TextField, styled } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import matchCaseIcon from "@/assets/image/component/match_case.svg?react";
import matchWholeWordIcon from "@/assets/image/component/match_whole_word.svg?react";
import useRegularExpressionIcon from "@/assets/image/component/use_regular_expression.svg?react";

export type SearchState = {
  text: string;
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegularExpression: boolean;
};

type SearchProps = {
  placeholder?: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  useRegularExpression?: boolean;
  onSearch: (match: (content: string) => boolean, state: SearchState) => void;
};

const StyledTextField = styled(TextField)(({ theme }) => ({
  "& .MuiInputBase-root": {
    background: theme.palette.mode === "light" ? "#fff" : undefined,
    paddingRight: "4px",
  },
  "& .MuiInputBase-root svg[aria-label='active'] path": {
    fill: theme.palette.primary.light,
  },
  "& .MuiInputBase-root svg[aria-label='inactive'] path": {
    fill: "#A7A7A7",
  },
}));

export const BaseSearchBox = ({
  placeholder,
  matchCase: defaultMatchCase = false,
  matchWholeWord: defaultMatchWholeWord = false,
  useRegularExpression: defaultUseRegularExpression = false,
  onSearch,
}: SearchProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const onSearchRef = useRef(onSearch);
  const [matchCase, setMatchCase] = useState(defaultMatchCase);
  const [matchWholeWord, setMatchWholeWord] = useState(defaultMatchWholeWord);
  const [useRegularExpression, setUseRegularExpression] = useState(
    defaultUseRegularExpression,
  );
  const [errorMessage, setErrorMessage] = useState("");

  const iconStyle = {
    style: {
      height: "24px",
      width: "24px",
      cursor: "pointer",
    } as React.CSSProperties,
    inheritViewBox: true,
  };

  // Helper that verifies whether a pattern is a valid regular expression
  const validateRegex = useCallback((pattern: string) => {
    if (!pattern) return true;
    try {
      new RegExp(pattern);
      return true;
    } catch (e) {
      console.warn("[BaseSearchBox] validateRegex error:", e);
      return false;
    }
  }, []);

  const createMatcher = useMemo(() => {
    return (searchText: string) => {
      if (useRegularExpression && searchText) {
        const isValid = validateRegex(searchText);
        if (!isValid) {
          // Invalid regex should result in no match
          return () => false;
        }
      }

      return (content: string) => {
        if (!searchText) {
          return true;
        }

        const item = !matchCase ? content.toLowerCase() : content;
        const searchItem = !matchCase ? searchText.toLowerCase() : searchText;

        if (useRegularExpression) {
          return new RegExp(searchItem).test(item);
        }

        if (matchWholeWord) {
          return new RegExp(`\\b${searchItem}\\b`).test(item);
        }

        return item.includes(searchItem);
      };
    };
  }, [matchCase, matchWholeWord, useRegularExpression, validateRegex]);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    if (!inputRef.current) return;
    const value = inputRef.current.value;
    const matcher = createMatcher(value);
    onSearchRef.current(matcher, {
      text: value,
      matchCase,
      matchWholeWord,
      useRegularExpression,
    });
  }, [matchCase, matchWholeWord, useRegularExpression, createMatcher]);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target?.value ?? "";
    setErrorMessage("");

    // Validate regex input eagerly
    if (useRegularExpression && value) {
      const isValid = validateRegex(value);
      if (!isValid) {
        setErrorMessage(t("shared.validation.invalidRegex"));
      }
    }

    const matcher = createMatcher(value);
    onSearchRef.current(matcher, {
      text: value,
      matchCase,
      matchWholeWord,
      useRegularExpression,
    });
  };

  const handleToggleUseRegularExpression = () => {
    setUseRegularExpression((prev) => {
      const next = !prev;
      if (!next) {
        setErrorMessage("");
      } else {
        const value = inputRef.current?.value ?? "";
        if (value && !validateRegex(value)) {
          setErrorMessage(t("shared.validation.invalidRegex"));
        }
      }
      return next;
    });
  };

  return (
    <Tooltip title={errorMessage || ""} placement="bottom-start">
      <StyledTextField
        autoComplete="new-password"
        inputRef={inputRef}
        hiddenLabel
        fullWidth
        size="small"
        variant="outlined"
        spellCheck="false"
        placeholder={placeholder ?? t("shared.placeholders.filter")}
        sx={{ input: { py: 0.65, px: 1.25 } }}
        onChange={onChange}
        error={!!errorMessage}
        slotProps={{
          input: {
            sx: { pr: 1 },
            endAdornment: (
              <Box display="flex">
                <Tooltip title={t("shared.placeholders.matchCase")}>
                  <div>
                    <SvgIcon
                      component={matchCaseIcon}
                      {...iconStyle}
                      aria-label={matchCase ? "active" : "inactive"}
                      onClick={() => setMatchCase((prev) => !prev)}
                    />
                  </div>
                </Tooltip>
                <Tooltip title={t("shared.placeholders.matchWholeWord")}>
                  <div>
                    <SvgIcon
                      component={matchWholeWordIcon}
                      {...iconStyle}
                      aria-label={matchWholeWord ? "active" : "inactive"}
                      onClick={() => setMatchWholeWord((prev) => !prev)}
                    />
                  </div>
                </Tooltip>
                <Tooltip title={t("shared.placeholders.useRegex")}>
                  <div>
                    <SvgIcon
                      component={useRegularExpressionIcon}
                      aria-label={useRegularExpression ? "active" : "inactive"}
                      {...iconStyle}
                      onClick={handleToggleUseRegularExpression}
                    />
                  </div>
                </Tooltip>
              </Box>
            ),
          },
        }}
      />
    </Tooltip>
  );
};
