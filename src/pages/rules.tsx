import useSWR from "swr";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { Box } from "@mui/material";
import { getRuleProviders, getRules } from "@/services/api";
import { BaseEmpty, BasePage, Notice } from "@/components/base";
import { RuleItem } from "@/components/rule/rule-item";
import { ProviderButton } from "@/components/rule/provider-button";
import { BaseSearchBox } from "@/components/base/base-search-box";
import { getCurrentProfileRuleProvidersPath } from "@/services/cmds";
import { readTextFile } from "@tauri-apps/api/fs";

const RulesPage = () => {
  const { t } = useTranslation();
  const { data = [] } = useSWR("getRules", getRules);
  const { data: ruleProvidersData } = useSWR(
    "getRuleProviders",
    getRuleProviders,
  );
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
            .filter(
              (o) =>
                o.trim().length > 0 &&
                !o.includes("#") &&
                !o.includes("payload"),
            );
          payloadArr.forEach((payload) => {
            if (match(payload)) {
              item.matchPayloadItems.push(payload);
            }
          });
        }
        return (
          match(item.payload) ||
          (item.matchPayloadItems && item.matchPayloadItems.length > 0)
        );
      });
  }, [data, ruleProvidersPaths, match]);

  const getAllRuleProvidersPaths = async () => {
    try {
      let pathsMap = await getCurrentProfileRuleProvidersPath();
      for (const name in pathsMap) {
        const contents = await readTextFile(pathsMap[name]);
        const payloadKey = name + payloadSuffix;
        pathsMap[payloadKey] = contents;
      }
      setRuleProvidersPaths(pathsMap);
    } catch (error) {
      Notice.error(t("Read Rule Providers Error"));
    }
  };

  useEffect(() => {
    getAllRuleProvidersPaths();
  }, [data, ruleProvidersData]);

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
        }}>
        {rules.length > 0 ? (
          <Virtuoso
            data={rules}
            increaseViewportBy={256}
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
