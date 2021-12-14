import axios, { AxiosInstance } from "axios";
import { getClashInfo } from "./command";

let axiosIns: AxiosInstance | null = null;

export async function getAxios() {
  if (axiosIns) return axiosIns;

  let server = "127.0.0.1:9090";
  let secret = "";

  try {
    const info = await getClashInfo();
    const { server: server_, secret: secret_ } = info?.controller ?? {};
    if (server_) server = server_;
    if (secret_) secret = secret_;
  } catch {}

  axiosIns = axios.create({
    baseURL: `http://${server}`,
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  });
  axiosIns.interceptors.response.use((r) => r.data);

  return axiosIns;
}
