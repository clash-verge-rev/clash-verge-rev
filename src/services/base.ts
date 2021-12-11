import axios from "axios";

const axiosIns = axios.create({
  baseURL: "http://127.0.0.1:9090",
});

axiosIns.interceptors.response.use((respone) => {
  return respone.data;
});

export default axiosIns;
