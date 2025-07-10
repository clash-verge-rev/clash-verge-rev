import { Box, SvgIcon, TextField, styled } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import matchCaseIcon from "@/assets/image/component/match_case.svg?react";
import matchWholeWordIcon from "@/assets/image/component/match_whole_word.svg?react";
import useRegularExpressionIcon from "@/assets/image/component/use_regular_expression.svg?react";
import { useTranslation } from "react-i18next";

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

export const BaseSearchBox = (props: SearchProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [matchCase, setMatchCase] = useState(props.matchCase ?? false);
  const [matchWholeWord, setMatchWholeWord] = useState(
    props.matchWholeWord ?? false,
  );
  const [useRegularExpression, setUseRegularExpression] = useState(
    props.useRegularExpression ?? false,
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

  // 验证正则表达式的辅助函数
  const validateRegex = (pattern: string) => {
    if (!pattern) return true;
    try {
      new RegExp(pattern);
      return true;
    } catch (e) {
      return false;
    }
  };

  const createMatcher = useMemo(() => {
    return (searchText: string) => {
      try {
        // 当启用正则表达式验证是否合规
        if (useRegularExpression && searchText) {
          const isValid = validateRegex(searchText);
          if (!isValid) {
            throw new Error(t("Invalid regular expression"));
          }
        }

        return (content: string) => {
          if (!searchText) return true;

          let item = !matchCase ? content.toLowerCase() : content;
          let searchItem = !matchCase ? searchText.toLowerCase() : searchText;

          if (useRegularExpression) {
            return new RegExp(searchItem).test(item);
          }

          if (matchWholeWord) {
            return new RegExp(`\\b${searchItem}\\b`).test(item);
          }

          return item.includes(searchItem);
        };
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : `${err}`);
        return () => false; // 无效正则规则 不匹配值
      }
    };
  }, [matchCase, matchWholeWord, useRegularExpression, t]);

  useEffect(() => {
    if (!inputRef.current) return;
    const value = inputRef.current.value;
    props.onSearch(createMatcher(value), {
      text: value,
      matchCase,
      matchWholeWord,
      useRegularExpression,
    });
  }, [matchCase, matchWholeWord, useRegularExpression, createMatcher]);

  const onChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target?.value ?? "";
    setErrorMessage("");

    // 验证正则表达式
    if (useRegularExpression && value) {
      const isValid = validateRegex(value);
      if (!isValid) {
        setErrorMessage(t("Invalid regular expression"));
      }
    }

    props.onSearch(createMatcher(value), {
      text: value,
      matchCase,
      matchWholeWord,
      useRegularExpression,
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
        placeholder={props.placeholder ?? t("Filter conditions")}
        sx={{ input: { py: 0.65, px: 1.25 } }}
        onChange={onChange}
        error={!!errorMessage}
        slotProps={{
          input: {
            sx: { pr: 1 },
            endAdornment: (
              <Box display="flex">
                <Tooltip title={t("Match Case")}>
                  <div>
                    <SvgIcon
                      component={matchCaseIcon}
                      {...iconStyle}
                      aria-label={matchCase ? "active" : "inactive"}
                      onClick={() => setMatchCase(!matchCase)}
                    />
                  </div>
                </Tooltip>
                <Tooltip title={t("Match Whole Word")}>
                  <div>
                    <SvgIcon
                      component={matchWholeWordIcon}
                      {...iconStyle}
                      aria-label={matchWholeWord ? "active" : "inactive"}
                      onClick={() => setMatchWholeWord(!matchWholeWord)}
                    />
                  </div>
                </Tooltip>
                <Tooltip title={t("Use Regular Expression")}>
                  <div>
                    <SvgIcon
                      component={useRegularExpressionIcon}
                      aria-label={useRegularExpression ? "active" : "inactive"}
                      {...iconStyle}
                      onClick={() =>
                        setUseRegularExpression(!useRegularExpression)
                      }
                    />{" "}
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
