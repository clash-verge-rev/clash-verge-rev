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

  const escapeRegex = useCallback((value: string) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }, []);

  const buildRegex = useCallback((pattern: string, flags = "") => {
    try {
      return new RegExp(pattern, flags);
    } catch (e) {
      console.warn("[BaseSearchBox] buildRegex error:", e);
      return null;
    }
  }, []);

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
  const validateRegex = useCallback(
    (pattern: string, flags = "") => {
      if (!pattern) return true;
      return !!buildRegex(pattern, flags);
    },
    [buildRegex],
  );

  const createMatcher = useMemo(() => {
    return (searchText: string) => {
      if (!searchText) {
        return () => true;
      }

      const flags = matchCase ? "" : "i";

      if (useRegularExpression) {
        const regex = buildRegex(searchText, flags);
        if (!regex) return () => false;

        return (content: string) => {
          try {
            return regex.test(content);
          } catch (e) {
            console.warn("[BaseSearchBox] regex match error:", e);
            return false;
          }
        };
      }

      if (matchWholeWord) {
        const regex = buildRegex(`\\b${escapeRegex(searchText)}\\b`, flags);
        if (!regex) return () => false;

        return (content: string) => {
          try {
            return regex.test(content);
          } catch (e) {
            console.warn("[BaseSearchBox] whole word match error:", e);
            return false;
          }
        };
      }

      return (content: string) => {
        const item = matchCase ? content : content.toLowerCase();
        const target = matchCase ? searchText : searchText.toLowerCase();
        return item.includes(target);
      };
    };
  }, [
    buildRegex,
    escapeRegex,
    matchCase,
    matchWholeWord,
    useRegularExpression,
  ]);

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
    const flags = matchCase ? "" : "i";

    // Validate regex input eagerly
    if (useRegularExpression && value) {
      const isValid = validateRegex(value, flags);
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
        const flags = matchCase ? "" : "i";
        if (value && !validateRegex(value, flags)) {
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
