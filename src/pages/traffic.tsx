/**
 * 作者: TanXiang
 * 日期: 2024/7/30
 * 描述: 流量统计
 */
import { BasePage } from "@/components/base";
import { Box, Button, ButtonGroup, useTheme } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  StatisticConfig,
  SupportedTimeUnits,
  TimeUnitType,
} from "@/services/traffic-worker";
import { useState } from "react";
import { LineChart } from "@mui/x-charts";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/services/indexed-db";
import dayjs from "dayjs";
import parseTraffic from "@/utils/parse-traffic";
import { axisClasses } from "@mui/x-charts/ChartsAxis";

const TrafficPage = () => {
  const { t } = useTranslation();
  const {
    palette: { primary, secondary },
  } = useTheme();

  const [statisticsUnit, toggleStatisticsUnit] =
    useState<TimeUnitType>("minute");

  const statisticData = useLiveQuery(
    () => {
      if (statisticsUnit === "second") {
        return db.trafficRecord
          .where("date")
          .above(dayjs().subtract(5, "minute").valueOf())
          .toArray();
      }
      return db.trafficStatistics
        .where("type")
        .equals(statisticsUnit)
        .toArray();
    },
    [statisticsUnit],
    []
  ) as Record<string, string | number>[];

  const trafficValueFormatter = (val: number | null) => {
    const [data, unit] = parseTraffic(val ?? 0);
    return `${data}${unit}`;
  };

  return (
    <BasePage
      full
      contentStyle={{ height: "100%" }}
      title={t("Traffic")}
      header={
        <Box display="flex" alignItems="center" gap={1}>
          <ButtonGroup size="small">
            {["second" as TimeUnitType, ...SupportedTimeUnits].map((unit) => (
              <Button
                key={unit}
                variant={unit === statisticsUnit ? "contained" : "outlined"}
                sx={{ textTransform: "capitalize" }}
                onClick={() => toggleStatisticsUnit(unit)}
              >
                {t(`${unit} dimension`)}
              </Button>
            ))}
          </ButtonGroup>
        </Box>
      }
    >
      <LineChart
        dataset={statisticData}
        xAxis={[
          {
            dataKey: "date",
            valueFormatter: (val) =>
              dayjs(val).format(
                StatisticConfig[statisticsUnit]?.format ?? "HH:mm:ss"
              ),
          },
        ]}
        yAxis={[
          {
            label: t("Traffic"),
            valueFormatter: trafficValueFormatter,
          },
        ]}
        sx={{
          [`.${axisClasses.left} .${axisClasses.label}`]: {
            transform: "translateX(-35px)",
          },
        }}
        series={[
          {
            dataKey: "up",
            showMark: false,
            label: t("Upstream"),
            color: secondary.main || "#9c27b0",
            valueFormatter: trafficValueFormatter,
          },
          {
            dataKey: "down",
            showMark: false,
            label: t("Downstream"),
            color: primary.main || "#5b5c9d",
            valueFormatter: trafficValueFormatter,
          },
        ]}
        margin={{ top: 50, right: 50, bottom: 50, left: 100 }}
      />
    </BasePage>
  );
};

export default TrafficPage;
