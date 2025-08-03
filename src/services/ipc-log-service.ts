// IPC-based log service using Tauri commands with streaming support
import {
  getClashLogs,
  startLogsMonitoring,
  stopLogsMonitoring,
  clearLogs as clearLogsCmd,
} from "@/services/cmds";
import dayjs from "dayjs";

export type LogLevel = "warning" | "info" | "debug" | "error" | "all";

export interface ILogItem {
  time?: string;
  type: string;
  payload: string;
  [key: string]: any;
}

// Start logs monitoring with specified level
export const startLogsStreaming = async (logLevel: LogLevel = "info") => {
  try {
    const level = logLevel === "all" ? undefined : logLevel;
    await startLogsMonitoring(level);
    console.log(
      `[IPC-LogService] Started logs monitoring with level: ${logLevel}`,
    );
  } catch (error) {
    console.error("[IPC-LogService] Failed to start logs monitoring:", error);
  }
};

// Stop logs monitoring
export const stopLogsStreaming = async () => {
  try {
    await stopLogsMonitoring();
    console.log("[IPC-LogService] Stopped logs monitoring");
  } catch (error) {
    console.error("[IPC-LogService] Failed to stop logs monitoring:", error);
  }
};

// Fetch logs using IPC command (now from streaming cache)
export const fetchLogsViaIPC = async (
  logLevel: LogLevel = "info",
): Promise<ILogItem[]> => {
  try {
    const level = logLevel === "all" ? undefined : logLevel;
    const response = await getClashLogs(level);

    // The response should be in the format expected by the frontend
    // Transform the logs to match the expected format
    if (Array.isArray(response)) {
      return response.map((log: any) => ({
        ...log,
        time: log.time || dayjs().format("HH:mm:ss"),
      }));
    }

    return [];
  } catch (error) {
    console.error("[IPC-LogService] Failed to fetch logs:", error);
    return [];
  }
};

// Clear logs
export const clearLogs = async () => {
  try {
    await clearLogsCmd();
    console.log("[IPC-LogService] Logs cleared");
  } catch (error) {
    console.error("[IPC-LogService] Failed to clear logs:", error);
  }
};
