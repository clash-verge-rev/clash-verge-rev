import { Box, IconButton, SvgIcon, TextField, styled } from "@mui/material";
import Tooltip from "@mui/material/Tooltip";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import { useTranslation } from "react-i18next";
import matchCaseIcon from "@/assets/image/component/match_case.svg?react";
import matchWholeWordIcon from "@/assets/image/component/match_whole_word.svg?react";
import useRegularExpressionIcon from "@/assets/image/component/use_regular_expression.svg?react";
import { debounce } from "lodash-es";

type SearchProps = {
  placeholder?: string;
  onSearch: (
    match: (content: string) => boolean,
    state: {
      text: string;
      matchCase: boolean;
      matchWholeWord: boolean;
      useRegularExpression: boolean;
    },
  ) => void;
};

export const BaseSearchBox = styled((props: SearchProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchOptions, setSearchOptions] = useState({
    matchCase: true,
    matchWholeWord: false,
    useRegularExpression: false,
  });
  const [errorMessage, setErrorMessage] = useState("");

  const iconStyle = {
    style: {
      height: "24px",
      width: "24px",
      cursor: "pointer",
    } as React.CSSProperties,
    inheritViewBox: true,
  };

  useEffect(() => {
    if (!inputRef.current) return;

    onChange({ target: inputRef.current } as ChangeEvent<HTMLInputElement>);
  }, [searchOptions]);

  const onChange = debounce(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      props.onSearch(
        (content) => doSearch([content], e.target?.value ?? "").length > 0,
        { text: e.target?.value ?? "", ...searchOptions },
      );
    },
    500,
  );

  const doSearch = (searchList: string[], searchItem: string) => {
    setErrorMessage("");
    return searchList.filter((item) => {
      try {
        let searchItemCopy = searchItem;
        if (!searchOptions.matchCase) {
          item = item.toLowerCase();
          searchItemCopy = searchItemCopy.toLowerCase();
        }
        if (searchOptions.matchWholeWord) {
          const regex = new RegExp(`\\b${searchItemCopy}\\b`);
          if (searchOptions.useRegularExpression) {
            const regexWithOptions = new RegExp(searchItemCopy);
            return regexWithOptions.test(item) && regex.test(item);
          } else {
            return regex.test(item);
          }
        } else if (searchOptions.useRegularExpression) {
          const regex = new RegExp(searchItemCopy);
          return regex.test(item);
        } else {
          return item.includes(searchItemCopy);
        }
      } catch (err) {
        setErrorMessage(`${err}`);
      }
    });
  };

  return (
    <Tooltip title={errorMessage} placement="bottom-start">
      <TextField
        inputRef={inputRef}
        hiddenLabel
        fullWidth
        size="small"
        autoComplete="off"
        variant="outlined"
        spellCheck="false"
        placeholder={props.placeholder ?? t("Filter conditions")}
        sx={{ input: { py: 0.65, px: 1.25 } }}
        onChange={onChange}
        InputProps={{
          endAdornment: (
            <Box display="flex">
              <Tooltip title={t("Match Case")}>
                <IconButton size="small" sx={{ p: 0.5 }}>
                  <SvgIcon
                    fontSize="inherit"
                    component={matchCaseIcon}
                    {...iconStyle}
                    aria-label={searchOptions.matchCase ? "active" : "inactive"}
                    onClick={() => {
                      setSearchOptions((pre) => ({
                        ...pre,
                        matchCase: !pre.matchCase,
                      }));
                    }}
                  />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("Match Whole Word")}>
                <IconButton size="small" sx={{ p: 0.5 }}>
                  <SvgIcon
                    fontSize="inherit"
                    component={matchWholeWordIcon}
                    {...iconStyle}
                    aria-label={
                      searchOptions.matchWholeWord ? "active" : "inactive"
                    }
                    onClick={() => {
                      setSearchOptions((pre) => ({
                        ...pre,
                        matchWholeWord: !pre.matchWholeWord,
                      }));
                    }}
                  />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("Use Regular Expression")}>
                <IconButton size="small" sx={{ p: 0.5 }}>
                  <SvgIcon
                    fontSize="inherit"
                    component={useRegularExpressionIcon}
                    aria-label={
                      searchOptions.useRegularExpression ? "active" : "inactive"
                    }
                    {...iconStyle}
                    onClick={() => {
                      setSearchOptions((pre) => ({
                        ...pre,
                        useRegularExpression: !pre.useRegularExpression,
                      }));
                    }}
                  />
                </IconButton>
              </Tooltip>
            </Box>
          ),
        }}
        {...props}
      />
    </Tooltip>
  );
})(({ theme }) => ({
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
