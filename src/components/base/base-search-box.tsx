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

type SearchOptionState = Omit<SearchState, "text">;

type SearchProps = {
  value?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  placeholder?: string;
  matchCase?: boolean;
  matchWholeWord?: boolean;
  useRegularExpression?: boolean;
  searchState?: Partial<SearchOptionState>;
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
  value,
  defaultValue,
  autoFocus,
  placeholder,
  searchState,
  matchCase: defaultMatchCase = false,
  matchWholeWord: defaultMatchWholeWord = false,
  useRegularExpression: defaultUseRegularExpression = false,
  onSearch,
}: SearchProps) => {
  const { t } = useTranslation();
  const isTextControlled = value !== undefined;

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
  const lastSearchStateRef = useRef<SearchState | null>(null);
  const [matchCaseState, setMatchCaseState] = useState(defaultMatchCase);
  const [matchWholeWordState, setMatchWholeWordState] = useState(
    defaultMatchWholeWord,
  );
  const [useRegularExpressionState, setUseRegularExpressionState] = useState(
    defaultUseRegularExpression,
  );
  const [errorMessage, setErrorMessage] = useState("");

  const matchCase = searchState?.matchCase ?? matchCaseState;
  const matchWholeWord = searchState?.matchWholeWord ?? matchWholeWordState;
  const useRegularExpression =
    searchState?.useRegularExpression ?? useRegularExpressionState;
  const isMatchCaseControlled = searchState?.matchCase !== undefined;
  const isMatchWholeWordControlled = searchState?.matchWholeWord !== undefined;
  const isUseRegularExpressionControlled =
    searchState?.useRegularExpression !== undefined;

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

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  const getCurrentText = useCallback(() => {
    if (isTextControlled) return value ?? "";
    return inputRef.current?.value ?? "";
  }, [isTextControlled, value]);

  const createMatcher = useCallback(
    (
      searchText: string,
      options: SearchOptionState | SearchState,
    ): ((content: string) => boolean) => {
      if (!searchText) {
        return () => true;
      }

      const flags = options.matchCase ? "" : "i";

      if (options.useRegularExpression) {
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

      if (options.matchWholeWord) {
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
        const item = options.matchCase ? content : content.toLowerCase();
        const target = options.matchCase
          ? searchText
          : searchText.toLowerCase();
        return item.includes(target);
      };
    },
    [buildRegex, escapeRegex],
  );

  const emitSearch = useCallback(
    (nextState: SearchState) => {
      const matcher = createMatcher(nextState.text, nextState);
      onSearchRef.current(matcher, nextState);
      lastSearchStateRef.current = nextState;
    },
    [createMatcher],
  );

  const effectiveErrorMessage = useMemo(() => {
    if (!isTextControlled) return errorMessage;

    const text = value ?? "";
    if (!useRegularExpression || !text) return "";

    const flags = matchCase ? "" : "i";
    return validateRegex(text, flags)
      ? ""
      : t("shared.validation.invalidRegex");
  }, [
    errorMessage,
    isTextControlled,
    matchCase,
    t,
    useRegularExpression,
    validateRegex,
    value,
  ]);

  useEffect(() => {
    const text = getCurrentText();
    const nextState: SearchState = {
      text,
      matchCase,
      matchWholeWord,
      useRegularExpression,
    };

    const prevState = lastSearchStateRef.current;
    const isSameState =
      !!prevState &&
      prevState.text === nextState.text &&
      prevState.matchCase === nextState.matchCase &&
      prevState.matchWholeWord === nextState.matchWholeWord &&
      prevState.useRegularExpression === nextState.useRegularExpression;

    if (isSameState) return;

    emitSearch(nextState);
  }, [
    emitSearch,
    getCurrentText,
    matchCase,
    matchWholeWord,
    useRegularExpression,
  ]);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const text = e.target?.value ?? "";
    const flags = matchCase ? "" : "i";

    const nextErrorMessage =
      useRegularExpression && text && !validateRegex(text, flags)
        ? t("shared.validation.invalidRegex")
        : "";
    if (!isTextControlled) {
      setErrorMessage(nextErrorMessage);
    }

    const nextState: SearchState = {
      text,
      matchCase,
      matchWholeWord,
      useRegularExpression,
    };
    emitSearch(nextState);
  };

  const handleToggleUseRegularExpression = () => {
    const text = getCurrentText();
    const next = !useRegularExpression;

    if (!isUseRegularExpressionControlled) {
      setUseRegularExpressionState(next);
    }

    if (!isTextControlled) {
      if (!next) {
        setErrorMessage("");
      } else {
        const flags = matchCase ? "" : "i";
        setErrorMessage(
          text && !validateRegex(text, flags)
            ? t("shared.validation.invalidRegex")
            : "",
        );
      }
    }

    emitSearch({
      text,
      matchCase,
      matchWholeWord,
      useRegularExpression: next,
    });
  };

  const handleToggleMatchCase = () => {
    const text = getCurrentText();
    const next = !matchCase;
    if (!isMatchCaseControlled) {
      setMatchCaseState(next);
    }

    emitSearch({
      text,
      matchCase: next,
      matchWholeWord,
      useRegularExpression,
    });
  };

  const handleToggleMatchWholeWord = () => {
    const text = getCurrentText();
    const next = !matchWholeWord;
    if (!isMatchWholeWordControlled) {
      setMatchWholeWordState(next);
    }

    emitSearch({
      text,
      matchCase,
      matchWholeWord: next,
      useRegularExpression,
    });
  };

  return (
    <Tooltip title={effectiveErrorMessage || ""} placement="bottom-start">
      <StyledTextField
        autoComplete="new-password"
        inputRef={inputRef}
        hiddenLabel
        fullWidth
        size="small"
        variant="outlined"
        autoFocus={autoFocus}
        spellCheck="false"
        placeholder={placeholder ?? t("shared.placeholders.filter")}
        sx={{ input: { py: 0.65, px: 1.25 } }}
        onChange={onChange}
        error={!!effectiveErrorMessage}
        {...(isTextControlled
          ? { value: value ?? "" }
          : defaultValue !== undefined
            ? { defaultValue }
            : {})}
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
                      onClick={handleToggleMatchCase}
                    />
                  </div>
                </Tooltip>
                <Tooltip title={t("shared.placeholders.matchWholeWord")}>
                  <div>
                    <SvgIcon
                      component={matchWholeWordIcon}
                      {...iconStyle}
                      aria-label={matchWholeWord ? "active" : "inactive"}
                      onClick={handleToggleMatchWholeWord}
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
