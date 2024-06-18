import useSWR from "swr";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { Box } from "@mui/material";
import { getRules } from "@/services/api";
import { BaseEmpty, BasePage } from "@/components/base";
import RuleItem from "@/components/rule/rule-item";
import { ProviderButton } from "@/components/rule/provider-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { BaseSearchBox } from "@/components/base/base-search-box";
import { getCurrentProfileRuleProvidersPath } from "@/services/cmds";
import { readTextFile } from "@tauri-apps/api/fs";

const RulesPage = () => {
  const { t } = useTranslation();
  const { data = [] } = useSWR("getRules", getRules);
  const { theme } = useCustomTheme();
  const isDark = theme.palette.mode === "dark";
  const [match, setMatch] = useState(() => (_: string) => true);
  const [ruleProvidersPaths, setRuleProvidersPaths] = useState<
    Record<string, string>
  >({});
  const payloadSuffix = "-payload";

  const rules = useMemo(() => {
    return data
      .map((item) => {
        if (item.type === "RuleSet") {
          const itemName = item.payload;
          const payloadKey = itemName + payloadSuffix;
          item.ruleSetProviderPath = ruleProvidersPaths[itemName];
          item.ruleSetProviderPayload = ruleProvidersPaths[payloadKey];
        }
        return item;
      })
      .filter((item) => {
        if (item.ruleSetProviderPayload) {
          item.matchPayloadItems = [];
          const payloadArr = item.ruleSetProviderPayload
            .split("\n")
            .filter((o) => o.trim().length > 0);
          payloadArr.forEach((payload) => {
            if (match(payload)) {
              item.matchPayloadItems.push(payload);
            }
          });
        }
        return (
          match(item.payload) ||
          (item.ruleSetProviderPayload && match(item.ruleSetProviderPayload))
        );
      });
  }, [data, ruleProvidersPaths, match]);

  const getAllRuleProvidersPaths = async () => {
    let paths = await getCurrentProfileRuleProvidersPath();
    for (const name in paths) {
      const contents = await readTextFile(paths[name]);
      const payloadKey = name + payloadSuffix;
      paths[payloadKey] = contents;
    }
    setRuleProvidersPaths(paths);
  };

  useEffect(() => {
    getAllRuleProvidersPaths();
  }, []);

  return (
    <BasePage
      full
      title={t("Rules")}
      contentStyle={{ height: "100%" }}
      header={
        <Box display="flex" alignItems="center" gap={1}>
          <ProviderButton />
        </Box>
      }>
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
        }}>
        <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
      </Box>

      <Box
        height="calc(100% - 65px)"
        sx={{
          marginLeft: "10px",
          borderRadius: "8px",
          bgcolor: isDark ? "#282a36" : "#ffffff",
        }}>
        {rules.length > 0 ? (
          <Virtuoso
            data={rules}
            itemContent={(index, item) => (
              <RuleItem index={index + 1} item={item} />
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
