import useSWR from "swr";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { Box, TextField } from "@mui/material";
import { getRules } from "@/services/api";
import { BaseEmpty, BasePage } from "@/components/base";
import RuleItem from "@/components/rule/rule-item";
import { ProviderButton } from "@/components/rule/provider-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";

const RulesPage = () => {
  const { t } = useTranslation();
  const { data = [] } = useSWR("getRules", getRules);
  const { theme } = useCustomTheme();
  const isDark = theme.palette.mode === "dark";
  const [filterText, setFilterText] = useState("");

  const rules = useMemo(() => {
    return data.filter((each) => each.payload.includes(filterText));
  }, [data, filterText]);

  return (
    <BasePage
      full
      title={t("Rules")}
      contentStyle={{ height: "100%" }}
      header={
        <Box display="flex" alignItems="center" gap={1}>
          <ProviderButton />
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <TextField
          hiddenLabel
          fullWidth
          size="small"
          autoComplete="off"
          variant="outlined"
          spellCheck="false"
          placeholder={t("Filter conditions")}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          sx={{ input: { py: 0.65, px: 1.25 } }}
        />
      </Box>

      <Box
        height="calc(100% - 65px)"
        sx={{
          margin: "10px",
          borderRadius: "8px",
          bgcolor: isDark ? "#282a36" : "#ffffff",
        }}
      >
        {rules.length > 0 ? (
          <Virtuoso
            data={rules}
            itemContent={(index, item) => (
              <RuleItem index={index + 1} value={item} />
            )}
            followOutput={"smooth"}
          />
        ) : (
          <BaseEmpty text="No Rules" />
        )}
      </Box>
    </BasePage>
  );
};

export default RulesPage;
