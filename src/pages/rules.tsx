import { BaseEmpty, BasePage, BaseSearchBox } from "@/components/base";
import { ProviderButton } from "@/components/rule/provider-button";
import { RuleItem } from "@/components/rule/rule-item";
import { getRuleProviderPayload } from "@/services/cmds";
import ExpandIcon from "@mui/icons-material/Expand";
import VerticalAlignCenterIcon from "@mui/icons-material/VerticalAlignCenter";
import { Box, IconButton } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import useSWR from "swr";
import {
  getRuleProviders,
  getRules,
  Rule,
  RuleBehavior,
  RuleFormat,
} from "tauri-plugin-mihomo-api";
import LoadingPage from "./loading";

export type CustomRule = Rule &
  RulePayload & {
    updateAt?: string;
    behavior?: RuleBehavior;
    format?: RuleFormat;
    expanded: boolean;
    matchPayloadItems: string[];
  };

const RulesPage = () => {
  const { t } = useTranslation();

  const { data, isLoading } = useSWR("getRules", async () => {
    const rules = await getRules();
    const customRules = rules.rules.map((item) => {
      return item as CustomRule;
    });
    return customRules;
  });

  const [customRules, setCustomRules] = useState<CustomRule[] | null>(null);
  useEffect(() => {
    if (!data) return;
    getRuleProviders().then(async (ruleProviders) => {
      const res: CustomRule[] = [];
      for (let rule of data) {
        const provider = ruleProviders.providers[rule.payload];
        if (provider) {
          let payload = await getRuleProviderPayload(
            provider.name,
            provider.behavior,
            provider.format,
          );
          res.push({
            ...rule,
            ...payload,
            behavior: provider.behavior,
            format: provider.format,
            updateAt: provider.updatedAt,
          } as CustomRule);
        } else {
          res.push(rule as CustomRule);
        }
      }
      setCustomRules(res);
    });
  }, [data]);

  const [rules, setRules] = useState<CustomRule[]>([]);
  const [match, setMatch] = useState(() => (_: string) => true);
  const hasRuleSet = rules?.findIndex((item) => item.type === "RuleSet") !== -1;

  useEffect(() => {
    if (!customRules) return;

    const filterData = customRules
      .map((item) => {
        // 清空上一次搜索匹配的规则
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
  }, [customRules, match]);

  if (customRules === null) {
    return <LoadingPage />;
  }

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
