/**
 * 作者: TanXiang
 * 日期: 2024/7/26
 * 描述: IndexedDB操作
 */
import Dexie, { Table } from "dexie";

export class TrafficDB extends Dexie {
  trafficRecord!: Table<TrafficRecord, number>;
  trafficStatistics!: Table<TrafficStatistics, number>;

  constructor() {
    super("TrafficDB");
    this.version(0.1).stores({
      trafficRecord: "date",
      trafficStatistics: "date, type",
    });
  }

  async addTrafficRecord(record: TrafficRecord) {
    try {
      const sametimeRecord = await this.trafficRecord.get(record.date);
      if (sametimeRecord) {
        await this.trafficRecord.update(record.date, {
          up: sametimeRecord.up + record.up,
          down: sametimeRecord.down + record.down,
        });
      }
      await this.trafficRecord.add(record);
    } catch (err: any) {
      console.error(err.message || err.toString(), record);
    }
  }

  async getLastTrafficStatistics(
    type: string
  ): Promise<TrafficStatistics | undefined> {
    return this.trafficStatistics
      .where({ type })
      .reverse()
      .sortBy("latest")
      .then((res) => res.at(0));
  }

  async putTrafficStatistics(statistics: TrafficStatistics[]) {
    if (statistics?.length > 0) {
      await this.trafficStatistics.bulkPut(statistics);
    }
  }
}

export const db = new TrafficDB();
