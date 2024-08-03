import useSWR from "swr";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { Box } from "@mui/material";
import { getRules } from "@/services/api";
import { BaseEmpty, BasePage } from "@/components/base";
import RuleItem from "@/components/rule/rule-item";
import { ProviderButton } from "@/components/rule/provider-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { BaseSearchBox } from "@/components/base/base-search-box";

const RulesPage = () => {
  const { t } = useTranslation();
  const { data = [] } = useSWR("getRules", getRules);
  const { theme } = useCustomTheme();
  const isDark = theme.palette.mode === "dark";
  const [match, setMatch] = useState(() => (_: string) => true);

  const rules = useMemo(() => {
    return data.filter((item) => match(item.payload));
  }, [data, match]);

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
        <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
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
          <BaseEmpty />
        )}
      </Box>
    </BasePage>
  );
};

export default RulesPage;
