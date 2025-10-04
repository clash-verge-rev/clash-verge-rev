import {
  useGlobalLogData,
  clearGlobalLogs,
  // LogLevel,
} from "@/services/global-log-service";

// 为了向后兼容，导出相同的类型
// export type { LogLevel };

export const useLogData = useGlobalLogData;

export const clearLogs = clearGlobalLogs;
