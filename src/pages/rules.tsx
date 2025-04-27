import { BaseEmpty, BasePage, BaseSearchBox } from "@/components/base";
import { ProviderButton } from "@/components/rule/provider-button";
import { RuleItem } from "@/components/rule/rule-item";
import { getRuleProvidersPayload } from "@/services/cmds";
import ExpandIcon from "@mui/icons-material/Expand";
import VerticalAlignCenterIcon from "@mui/icons-material/VerticalAlignCenter";
import { Box, IconButton } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import useSWR from "swr";
import { getRules, Rule } from "tauri-plugin-mihomo-api";
import LoadingPage from "./loading";

type CustomRule = Rule &
  RulePayload & {
    expanded: boolean;
    matchPayloadItems: string[];
  };

const RulesPage = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useSWR("getRules", async () => {
    const rules = await getRules();
    const ruleProvidersPayload = await getRuleProvidersPayload();
    const customRules = rules.rules.map((item) => {
      const ruleName = item.payload;
      if (ruleProvidersPayload[ruleName]) {
        return { ...item, ...ruleProvidersPayload[ruleName] } as CustomRule;
      }
      return item as CustomRule;
    });
    return customRules;
  });

  const [rules, setRules] = useState<CustomRule[]>([]);
  const [match, setMatch] = useState(() => (_: string) => true);
  const hasRuleSet = rules?.findIndex((item) => item.type === "RuleSet") !== -1;

  useEffect(() => {
    if (!data) return;

    const filterData = data
      .map((item) => {
        item.expanded =
          rules.find((rItem) => rItem.payload === item.payload)?.expanded ??
          false;
        item.matchPayloadItems = [];
        return item;
      })
      .filter((item) => {
        if (item.rules && item.rules.length > 0) {
          item.rules.forEach((rule) => {
            if (match(rule)) {
              item.matchPayloadItems.push(rule);
            }
          });
        }
        if (item.type === "RuleSet") {
          return item.matchPayloadItems && item.matchPayloadItems.length > 0;
        } else {
          return match(item.payload);
        }
      });
    setRules(filterData);
  }, [data, match]);

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
          mb: "10px",
          pt: "10px",
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          boxSizing: "border-box",
        }}>
        <BaseSearchBox onSearch={(match) => setMatch(() => match)} />
      </Box>

      <Box
        height={"calc(100% - 50px)"}
        sx={{
          boxSizing: "border-box",
          mb: "4px",
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
                  // console.log(item);
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
        ) : isLoading ? (
          <LoadingPage />
        ) : (
          <BaseEmpty text="No Rules" />
        )}
      </Box>
    </BasePage>
  );
};

export default RulesPage;
