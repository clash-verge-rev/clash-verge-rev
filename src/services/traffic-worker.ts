/**
 * 作者: TanXiang
 * 日期: 2024/7/29
 * 描述: 流量处理子线程
 */
import { db } from "./indexed-db";
import dayjs, { UnitTypeLong } from "dayjs";
import { groupBy, map, sumBy } from "lodash-es";

const LOG_RETENTION_PERIOD = 300; // 日志记录保留时长（5分钟）
const AGGREGATION_INTERVAL_MS = 60000; // 汇总间隔1分钟

type TimeUnitType = Exclude<UnitTypeLong, "date" | "millisecond">;
type TimeUnitOption = { format: string; logPeriod: number };
const StatisticConfig: Partial<Record<TimeUnitType, TimeUnitOption>> = {
  minute: { format: "YYYY-MM-DD HH:mm", logPeriod: 120 },
  hour: { format: "YYYY-MM-DD HH:00", logPeriod: 24 },
  day: { format: "YYYY-MM-DD", logPeriod: 31 },
  month: { format: "YYYY-MM", logPeriod: 12 },
  year: { format: "YYYY ", logPeriod: 1 },
};
const SupportedTimeUnits = Object.keys(StatisticConfig) as TimeUnitType[];

let aggregationTimer: NodeJS.Timeout;

self.onmessage = async (event) => {
  const { type, data } = event.data;
  switch (type) {
    case "TRAFFIC": {
      await addRecord(data);
      break;
    }
    case "TERMINATE": {
      clearTimeout(aggregationTimer);
      break;
    }
  }
};

/**
 * 添加记录
 * @param data 流量数据
 */
async function addRecord(data: ITrafficItem) {
  if (data == null || (data.up === 0 && data.down === 0)) {
    return;
  }

  await db.addTrafficRecord({ date: dayjs().valueOf(), ...data });
}

/**
 * 异步聚合流量记录。
 * 根据类型查询并聚合流量记录或流量统计数据，生成新的流量统计数据。
 * @param type 流量记录的类型，用于确定查询和聚合的方式。
 */
async function aggregateRecords(type: TimeUnitType) {
  // 流量记录或流量统计数据
  let records: (TrafficRecord | TrafficStatistics)[];

  // 以最后一条统计数据，确定起始时间
  const latestRecord = await db.getLastTrafficStatistics(type);
  const startTime = latestRecord?.date ?? 0;

  if (type === SupportedTimeUnits[0]) {
    // 如果类型为第一种，则查询所有的流量记录
    records = await db.trafficRecord
      .where("date")
      .aboveOrEqual(startTime)
      .toArray();
  } else if (SupportedTimeUnits.indexOf(type) > 0) {
    // 如果类型不是第一种，则查询前一种类型的流量统计数据
    const _sourceType =
      SupportedTimeUnits[SupportedTimeUnits.indexOf(type) - 1];
    records = await db.trafficStatistics
      .where("type")
      .equals(_sourceType)
      .filter((m) => m.date >= startTime)
      .toArray();
  } else {
    // 类型无效，终止执行
    console.error("Invalid type value.", type);
    return;
  }

  // 根据类型确定的时间单位进行分组
  const groupedRecords = groupBy(records, (record) => {
    return dayjs(record.date).startOf(type).valueOf();
  });

  // 汇总
  const statisticRecords = map(groupedRecords, (_records, _date) => {
    let up = sumBy(_records, "up");
    let down = sumBy(_records, "down");
    const date = Number(_date);

    return {
      date,
      up,
      down,
      type,
    } as TrafficStatistics;
  });
  await db.putTrafficStatistics(statisticRecords);
}

/**
 * 异步清理过期的记录。
 * 根据指定的时间单位类型，查找并清理早于最新记录一定时间间隔的记录。
 * 这个函数主要用于维护数据库中的流量统计数据，确保数据量在可管理范围内。
 *
 * @param type 时间单位类型，用于确定清理的粒度，例如：小时、天、周等。
 */
async function cleanupRecords(type: TimeUnitType) {
  // 查询下一个类别的最后数据数据时间，确定可删除的当前数据范围
  const nextTypeIndex = SupportedTimeUnits.indexOf(type) + 1;
  const nextType =
    nextTypeIndex < SupportedTimeUnits.length
      ? SupportedTimeUnits[nextTypeIndex]
      : type;

  const latestRecord = await db.getLastTrafficStatistics(nextType);
  if (!latestRecord) {
    // 如果没有下一个类别的数据，说明还没汇总，不执行删除
    return;
  }

  // 计算需要清理的时间点，基于最新记录的时间往前推算
  const cleanupTime = dayjs(latestRecord.date)
    .subtract(StatisticConfig[type]?.logPeriod ?? LOG_RETENTION_PERIOD, type)
    .valueOf();

  if (nextType === SupportedTimeUnits[0]) {
    await db.trafficRecord.where("date").below(cleanupTime).delete();
  } else {
    await db.trafficStatistics
      .where("type")
      .equals(type)
      .filter((m) => m.date < cleanupTime)
      .delete();
  }
}

/**
 * 启动一个后台任务。
 * 该函数定期汇总数据，并清理过期记录。
 */
async function startBackgroundTask() {
  const aggregate = async () => {
    // 数据汇总
    for (const type of SupportedTimeUnits) {
      await aggregateRecords(type);
    }

    // 首数据清理
    for (const type of ["second" as TimeUnitType, ...SupportedTimeUnits]) {
      await cleanupRecords(type);
    }

    aggregationTimer = setTimeout(aggregate, AGGREGATION_INTERVAL_MS);
  };

  // 初始化
  await aggregate();
}

// 自启动后台任务
(async () => {
  await startBackgroundTask();
})();

export { type TimeUnitType, StatisticConfig, SupportedTimeUnits };
