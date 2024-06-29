import { BaseEmpty, BasePage } from "@/components/base";
import { BaseSearchBox } from "@/components/base/base-search-box";
import { ProviderButton } from "@/components/rule/provider-button";
import { RuleItem } from "@/components/rule/rule-item";
import { getRuleProviders, getRules } from "@/services/api";
import { getCurrentProfileRuleProvidersPath } from "@/services/cmds";
import ExpandIcon from "@mui/icons-material/Expand";
import VerticalAlignCenterIcon from "@mui/icons-material/VerticalAlignCenter";
import { Box, IconButton } from "@mui/material";
import { readTextFile } from "@tauri-apps/api/fs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import useSWR from "swr";

const RulesPage = () => {
  const { t } = useTranslation();
  const { data = [] } = useSWR("getRules", getRules);
  const { data: ruleProvidersData } = useSWR(
    "getRuleProviders",
    getRuleProviders,
  );
  const [rules, setRules] = useState(data);
  const [match, setMatch] = useState(() => (_: string) => true);
  const [ruleProvidersPaths, setRuleProvidersPaths] = useState<
    Record<string, string>
  >({});
  const payloadSuffix = "-payload";
  const hasRuleSet = rules.findIndex((item) => item.type === "RuleSet") !== -1;

  useEffect(() => {
    const filterData = data
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
                !o.includes("payload:"),
            )
            .map((o) => o.trim());
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
    setRules(filterData);
  }, [data, match, ruleProvidersPaths]);

  const getAllRuleProvidersPaths = async () => {
    let pathsMap = await getCurrentProfileRuleProvidersPath();
    // 读取规则集文件内容
    for (const name in pathsMap) {
      const payloadKey = name + payloadSuffix;
      const contents = await readTextFile(pathsMap[name]);
      pathsMap[payloadKey] = contents;
    }
    setRuleProvidersPaths(pathsMap);
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
          {hasRuleSet && (
            <>
              <IconButton
                title={t("Expand All")}
                color="primary"
                size="small"
                onClick={() => {
                  setRules((pre) =>
                    pre.map((o) => {
                      o.expanded = true;
                      return o;
                    }),
                  );
                }}>
                <ExpandIcon />
              </IconButton>
              <IconButton
                title={t("Collapse All")}
                color="primary"
                size="small"
                onClick={() => {
                  setRules((pre) =>
                    pre.map((o) => {
                      o.expanded = false;
                      return o;
                    }),
                  );
                }}>
                <VerticalAlignCenterIcon />
              </IconButton>
            </>
          )}
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
            totalCount={rules.length}
            itemContent={(index, item) => (
              <RuleItem
                key={item.payload}
                index={index + 1}
                value={item}
                onExpand={(expanded) => {
                  setRules((pre) =>
                    pre.map((o) => {
                      if (o.payload === item.payload) {
                        o.expanded = !expanded;
                      }
                      return o;
                    }),
                  );
                }}
              />
            )}
          />
        ) : (
          <BaseEmpty text="No Rules" />
        )}
      </Box>
    </BasePage>
  );
};

export default RulesPage;
