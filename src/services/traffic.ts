import axios from "axios";
import axiosIns from "./base";

export interface TrafficData {
  up: number;
  down: number;
}

/// Get the traffic stream
export async function getTraffic(callback: (data: TrafficData) => void) {
  const source = axios.CancelToken.source();

  axiosIns.get("/traffic", {
    cancelToken: source.token,
    onDownloadProgress: (progressEvent) => {
      const data = progressEvent.currentTarget.response || "";
      const lastData = data.slice(data.trim().lastIndexOf("\n") + 1);

      if (!lastData) callback({ up: 0, down: 0 });
      try {
        callback(JSON.parse(lastData) as TrafficData);
      } catch {
        callback({ up: 0, down: 0 });
      }
    },
  });

  return source;
}
