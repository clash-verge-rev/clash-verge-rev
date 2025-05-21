import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { Box } from "@mui/material";
import { BaseEmpty, BasePage } from "@/components/base";
import RuleItem from "@/components/rule/rule-item";
import { ProviderButton } from "@/components/rule/provider-button";
import { BaseSearchBox } from "@/components/base/base-search-box";
import { ScrollTopButton } from "@/components/layout/scroll-top-button";
import { useAppData } from "@/providers/app-data-provider";
import { useVisibility } from "@/hooks/use-visibility";

const RulesPage = () => {
  const { t } = useTranslation();
  const { rules = [], refreshRules, refreshRuleProviders } = useAppData();
  const [match, setMatch] = useState(() => (_: string) => true);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const pageVisible = useVisibility();

  // 在组件挂载时和页面获得焦点时刷新规则数据
  useEffect(() => {
    refreshRules();
    refreshRuleProviders();

    if (pageVisible) {
      refreshRules();
      refreshRuleProviders();
    }
  }, [refreshRules, refreshRuleProviders, pageVisible]);

  const filteredRules = useMemo(() => {
    return rules.filter((item) => match(item.payload));
  }, [rules, match]);

  const scrollToTop = () => {
    virtuosoRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const handleScroll = (e: any) => {
    setShowScrollTop(e.target.scrollTop > 100);
  };

  return (
    <BasePage
      full
      title={t("Rules")}
      contentStyle={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
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

      {filteredRules.length > 0 ? (
        <>
          <Virtuoso
            ref={virtuosoRef}
            data={filteredRules}
            style={{
              flex: 1,
            }}
            itemContent={(index, item) => (
              <RuleItem index={index + 1} value={item} />
            )}
            followOutput={"smooth"}
            scrollerRef={(ref) => {
              if (ref) ref.addEventListener("scroll", handleScroll);
            }}
          />
          <ScrollTopButton onClick={scrollToTop} show={showScrollTop} />
        </>
      ) : (
        <BaseEmpty />
      )}
    </BasePage>
  );
};

export default RulesPage;
