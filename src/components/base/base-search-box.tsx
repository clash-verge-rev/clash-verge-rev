import matchCaseIcon from "@/assets/image/component/match_case.svg?react";
import matchWholeWordIcon from "@/assets/image/component/match_whole_word.svg?react";
import useRegularExpressionIcon from "@/assets/image/component/use_regular_expression.svg?react";
import { ClearRounded } from "@mui/icons-material";
import { Box, IconButton, SvgIcon, TextField, Tooltip } from "@mui/material";
import { useDebounce, useMemoizedFn } from "ahooks";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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

export const BaseSearchBox = (props: SearchProps) => {
  const { placeholder, onSearch } = props;
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState("");
  const debounceFilterText = useDebounce(filterText, { wait: 500 });
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
    onChange(debounceFilterText);
  }, [debounceFilterText, searchOptions]);

  const onChange = useMemoizedFn((text: string) => {
    onSearch((content) => doSearch([content], text), {
      text: text,
      ...searchOptions,
    });
  });

  const doSearch = (searchList: string[], searchItem: string) => {
    setErrorMessage("");
    return (
      searchList.filter((item) => {
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
      }).length > 0
    );
  };

  return (
    <Tooltip title={errorMessage} placement="bottom-start">
      <TextField
        hiddenLabel
        fullWidth
        size="small"
        autoComplete="off"
        variant="outlined"
        spellCheck="false"
        value={filterText}
        placeholder={placeholder ?? t("Filter conditions")}
        sx={[
          { input: { py: 0.65, px: 1.25 } },
          ({ palette: { mode } }) => {
            return { ...(mode === "light" && { backgroundColor: "#fff" }) };
          },
        ]}
        onChange={(e) => {
          setFilterText(() => e.target.value);
        }}
        slotProps={{
          input: {
            endAdornment: (
              <Box display="flex">
                {filterText !== "" && (
                  <Tooltip title={t("Clear")}>
                    <IconButton
                      size="small"
                      color="primary"
                      sx={{ p: 0.5 }}
                      onClick={() => setFilterText("")}>
                      <ClearRounded fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title={t("Match Case")}>
                  <IconButton
                    size="small"
                    sx={{ p: 0.5 }}
                    color={searchOptions.matchCase ? "primary" : "default"}
                    onClick={() => {
                      setSearchOptions((pre) => ({
                        ...pre,
                        matchCase: !pre.matchCase,
                      }));
                    }}>
                    <SvgIcon
                      fontSize="inherit"
                      component={matchCaseIcon}
                      {...iconStyle}
                    />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("Match Whole Word")}>
                  <IconButton
                    size="small"
                    sx={{ p: 0.5 }}
                    color={searchOptions.matchWholeWord ? "primary" : "default"}
                    onClick={() => {
                      setSearchOptions((pre) => ({
                        ...pre,
                        matchWholeWord: !pre.matchWholeWord,
                      }));
                    }}>
                    <SvgIcon
                      fontSize="inherit"
                      component={matchWholeWordIcon}
                      {...iconStyle}
                    />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("Use Regular Expression")}>
                  <IconButton
                    size="small"
                    sx={{ p: 0.5 }}
                    color={
                      searchOptions.useRegularExpression ? "primary" : "default"
                    }
                    onClick={() => {
                      setSearchOptions((pre) => ({
                        ...pre,
                        useRegularExpression: !pre.useRegularExpression,
                      }));
                    }}>
                    <SvgIcon
                      fontSize="inherit"
                      component={useRegularExpressionIcon}
                      {...iconStyle}
                    />
                  </IconButton>
                </Tooltip>
              </Box>
            ),
          },
        }}
      />
    </Tooltip>
  );
};
