import useSWR from "swr";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { Box, Paper, TextField } from "@mui/material";
import { getRules } from "@/services/api";
import { BaseEmpty, BasePage } from "@/components/base";
import RuleItem from "@/components/rule/rule-item";

const RulesPage = () => {
  const { t } = useTranslation();
  const { data = [] } = useSWR("getRules", getRules);

  const [filterText, setFilterText] = useState("");

  const rules = useMemo(() => {
    return data.filter((each) => each.payload.includes(filterText));
  }, [data, filterText]);

  return (
    <BasePage title={t("Rules")} contentStyle={{ height: "100%" }}>
      <Paper sx={{ boxSizing: "border-box", boxShadow: 2, height: "100%" }}>
        <Box
          sx={{
            pt: 1,
            mb: 0.5,
            mx: "12px",
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

        <Box height="calc(100% - 50px)">
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
      </Paper>
    </BasePage>
  );
};

export default RulesPage;
