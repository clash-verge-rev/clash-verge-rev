import { invoke } from "@tauri-apps/api/core";
import dayjs from "dayjs";
import { getProxies, getProxyProviders } from "tauri-plugin-mihomo-api";

import { showNotice } from "@/services/notice-service";
import { debugLog } from "@/utils/debug";

export async function copyClashEnv() {
  return invoke<void>("copy_clash_env");
}

export async function getProfiles() {
  return invoke<IProfilesConfig>("get_profiles");
}

export async function enhanceProfiles() {
  return invoke<void>("enhance_profiles");
}

export async function patchProfilesConfig(profiles: IProfilesConfig) {
  return invoke<boolean>("patch_profiles_config", { profiles });
}

export async function createProfile(
  item: Partial<IProfileItem>,
  fileData?: string | null,
) {
  return invoke<void>("create_profile", { item, fileData });
}

export async function viewProfile(index: string) {
  return invoke<void>("view_profile", { index });
}

export async function readProfileFile(index: string) {
  return invoke<string>("read_profile_file", { index });
}

export async function saveProfileFile(index: string, fileData: string) {
  return invoke<void>("save_profile_file", { index, fileData });
}

export async function importProfile(url: string, option?: IProfileOption) {
  return invoke<void>("import_profile", {
    url,
    option: option || { with_proxy: true },
  });
}

export async function reorderProfile(activeId: string, overId: string) {
  return invoke<void>("reorder_profile", {
    activeId,
    overId,
  });
}

export async function updateProfile(index: string, option?: IProfileOption) {
  return invoke<void>("update_profile", { index, option });
}

export async function deleteProfile(index: string) {
  return invoke<void>("delete_profile", { index });
}

export async function patchProfile(
  index: string,
  profile: Partial<IProfileItem>,
) {
  return invoke<void>("patch_profile", { index, profile });
}

export async function getClashInfo() {
  return invoke<IClashInfo | null>("get_clash_info");
}

// Get runtime config which controlled by verge
export async function getRuntimeConfig() {
  return invoke<IConfigData | null>("get_runtime_config");
}

export async function getRuntimeYaml() {
  return invoke<string | null>("get_runtime_yaml");
}

export async function getRuntimeExists() {
  return invoke<string[]>("get_runtime_exists");
}

export async function getRuntimeLogs() {
  return invoke<Record<string, [string, string][]>>("get_runtime_logs");
}

export async function getRuntimeProxyChainConfig(proxyChainExitNode: string) {
  return invoke<string>("get_runtime_proxy_chain_config", {
    proxyChainExitNode,
  });
}

export async function updateProxyChainConfigInRuntime(proxyChainConfig: any) {
  return invoke<void>("update_proxy_chain_config_in_runtime", {
    proxyChainConfig,
  });
}

export async function patchClashConfig(payload: Partial<IConfigData>) {
  return invoke<void>("patch_clash_config", { payload });
}

export async function patchClashMode(payload: string) {
  return invoke<void>("patch_clash_mode", { payload });
}

export async function syncTrayProxySelection() {
  return invoke<void>("sync_tray_proxy_selection");
}

export async function calcuProxies(): Promise<{
  global: IProxyGroupItem;
  direct: IProxyItem;
  groups: IProxyGroupItem[];
  records: Record<string, IProxyItem>;
  proxies: IProxyItem[];
}> {
  const [proxyResponse, providerResponse] = await Promise.all([
    getProxies(),
    calcuProxyProviders(),
  ]);

  const proxyRecord = proxyResponse.proxies;
  const providerRecord = providerResponse;

  // provider name map
  const providerMap = Object.fromEntries(
    Object.entries(providerRecord).flatMap(([provider, item]) =>
      item!.proxies.map((p) => [p.name, { ...p, provider }]),
    ),
  );

  // compatible with proxy-providers
  const generateItem = (name: string) => {
    if (proxyRecord[name]) return proxyRecord[name];
    if (providerMap[name]) return providerMap[name];
    return {
      name,
      type: "unknown",
      udp: false,
      xudp: false,
      tfo: false,
      mptcp: false,
      smux: false,
      history: [],
    };
  };

  const { GLOBAL: global, DIRECT: direct, REJECT: reject } = proxyRecord;

  let groups: IProxyGroupItem[] = Object.values(proxyRecord).reduce<
    IProxyGroupItem[]
  >((acc, each) => {
    if (each?.name !== "GLOBAL" && each?.all) {
      acc.push({
        ...each,
        all: each.all!.map((item) => generateItem(item)),
      });
    }

    return acc;
  }, []);

  if (global?.all) {
    const globalGroups: IProxyGroupItem[] = global.all.reduce<
      IProxyGroupItem[]
    >((acc, name) => {
      if (proxyRecord[name]?.all) {
        acc.push({
          ...proxyRecord[name],
          all: proxyRecord[name].all!.map((item) => generateItem(item)),
        });
      }
      return acc;
    }, []);

    const globalNames = new Set(globalGroups.map((each) => each.name));
    groups = groups
      .filter((group) => {
        return !globalNames.has(group.name);
      })
      .concat(globalGroups);
  }

  const proxies = [direct, reject].concat(
    Object.values(proxyRecord).filter(
      (p) => !p?.all?.length && p?.name !== "DIRECT" && p?.name !== "REJECT",
    ),
  );

  const _global = {
    ...global,
    all: global?.all?.map((item) => generateItem(item)) || [],
  };

  return {
    global: _global as IProxyGroupItem,
    direct: direct as IProxyItem,
    groups,
    records: proxyRecord as Record<string, IProxyItem>,
    proxies: (proxies as IProxyItem[]) ?? [],
  };
}

export async function calcuProxyProviders() {
  const providers = await getProxyProviders();
  return Object.fromEntries(
    Object.entries(providers.providers)
      .sort()
      .filter(
        ([_, item]) =>
          item?.vehicleType === "HTTP" || item?.vehicleType === "File",
      ),
  );
}

export async function getClashLogs() {
  const regex = /time="(.+?)"\s+level=(.+?)\s+msg="(.+?)"/;
  const newRegex = /(.+?)\s+(.+?)\s+(.+)/;
  const logs = await invoke<string[]>("get_clash_logs");

  return logs.reduce<ILogItem[]>((acc, log) => {
    const result = log.match(regex);
    if (result) {
      const [_, _time, type, payload] = result;
      const time = dayjs(_time).format("MM-DD HH:mm:ss");
      acc.push({ time, type, payload });
      return acc;
    }

    const result2 = log.match(newRegex);
    if (result2) {
      const [_, time, type, payload] = result2;
      acc.push({ time, type, payload });
    }
    return acc;
  }, []);
}

export async function clearLogs() {
  return invoke<void>("clear_logs");
}

export async function getVergeConfig() {
  return invoke<IVergeConfig>("get_verge_config");
}

export async function patchVergeConfig(payload: IVergeConfig) {
  return invoke<void>("patch_verge_config", { payload });
}

export async function getSystemProxy() {
  return invoke<{
    enable: boolean;
    server: string;
    bypass: string;
  }>("get_sys_proxy");
}

export async function getAutotemProxy() {
  try {
    debugLog("[API] 开始调用 get_auto_proxy");
    const result = await invoke<{
      enable: boolean;
      url: string;
    }>("get_auto_proxy");
    debugLog("[API] get_auto_proxy 调用成功:", result);
    return result;
  } catch (error) {
    console.error("[API] get_auto_proxy 调用失败:", error);
    return {
      enable: false,
      url: "",
    };
  }
}

export async function getAutoLaunchStatus() {
  try {
    return await invoke<boolean>("get_auto_launch_status");
  } catch (error) {
    console.error("获取自启动状态失败:", error);
    return false;
  }
}

export async function changeClashCore(clashCore: string) {
  return invoke<string | null>("change_clash_core", { clashCore });
}

export async function startCore() {
  return invoke<void>("start_core");
}

export async function stopCore() {
  return invoke<void>("stop_core");
}

export async function restartCore() {
  return invoke<void>("restart_core");
}

export async function restartApp() {
  return invoke<void>("restart_app");
}

export async function getAppDir() {
  return invoke<string>("get_app_dir");
}

export async function openAppDir() {
  return invoke<void>("open_app_dir").catch((err) => showNotice.error(err));
}

export async function openCoreDir() {
  return invoke<void>("open_core_dir").catch((err) => showNotice.error(err));
}

export async function openLogsDir() {
  return invoke<void>("open_logs_dir").catch((err) => showNotice.error(err));
}

export const openWebUrl = async (url: string) => {
  try {
    await invoke("open_web_url", { url });
  } catch (err: any) {
    showNotice.error(err);
  }
};

export async function cmdGetProxyDelay(
  name: string,
  timeout: number,
  url?: string,
) {
  // 确保URL不为空
  const testUrl = url || "http://104.16.132.229/generate_204";

  try {
    // 不再在前端编码代理名称，由后端统一处理编码
    const result = await invoke<{ delay: number }>(
      "clash_api_get_proxy_delay",
      {
        name,
        url: testUrl, // 传递经过验证的URL
        timeout,
      },
    );

    // 验证返回结果中是否有delay字段，并且值是一个有效的数字
    if (result && typeof result.delay === "number") {
      return result;
    } else {
      // 返回一个有效的结果对象，但标记为超时
      return { delay: 1e6 };
    }
  } catch {
    // 返回一个有效的结果对象，但标记为错误
    return { delay: 1e6 };
  }
}

export async function cmdTestDelay(url: string) {
  return invoke<number>("test_delay", { url });
}

export async function invoke_uwp_tool() {
  return invoke<void>("invoke_uwp_tool").catch((err) =>
    showNotice.error(err, 1500),
  );
}

export async function getPortableFlag() {
  return invoke<boolean>("get_portable_flag");
}

export async function openDevTools() {
  return invoke("open_devtools");
}

export async function exitApp() {
  return invoke("exit_app");
}

export async function exportDiagnosticInfo() {
  return invoke("export_diagnostic_info");
}

export async function getSystemInfo() {
  return invoke<string>("get_system_info");
}

export async function copyIconFile(
  path: string,
  name: "common" | "sysproxy" | "tun",
) {
  const key = `icon_${name}_update_time`;
  const previousTime = localStorage.getItem(key) || "";

  const currentTime = String(Date.now());
  localStorage.setItem(key, currentTime);

  const iconInfo = {
    name,
    previous_t: previousTime,
    current_t: currentTime,
  };

  return invoke<void>("copy_icon_file", { path, iconInfo });
}

export async function downloadIconCache(url: string, name: string) {
  return invoke<string>("download_icon_cache", { url, name });
}

export async function getNetworkInterfaces() {
  return invoke<string[]>("get_network_interfaces");
}

export async function getSystemHostname() {
  return invoke<string>("get_system_hostname");
}

export async function getNetworkInterfacesInfo() {
  return invoke<INetworkInterface[]>("get_network_interfaces_info");
}

export async function createWebdavBackup() {
  return invoke<void>("create_webdav_backup");
}

export async function createLocalBackup() {
  return invoke<void>("create_local_backup");
}

export async function deleteWebdavBackup(filename: string) {
  return invoke<void>("delete_webdav_backup", { filename });
}

export async function deleteLocalBackup(filename: string) {
  return invoke<void>("delete_local_backup", { filename });
}

export async function restoreWebDavBackup(filename: string) {
  return invoke<void>("restore_webdav_backup", { filename });
}

export async function restoreLocalBackup(filename: string) {
  return invoke<void>("restore_local_backup", { filename });
}

export async function importLocalBackup(source: string) {
  return invoke<string>("import_local_backup", { source });
}

export async function exportLocalBackup(filename: string, destination: string) {
  return invoke<void>("export_local_backup", { filename, destination });
}

export async function saveWebdavConfig(
  url: string,
  username: string,
  password: string,
) {
  return invoke<void>("save_webdav_config", {
    url,
    username,
    password,
  });
}

export async function listWebDavBackup() {
  const list: IWebDavFile[] = await invoke<IWebDavFile[]>("list_webdav_backup");
  list.map((item) => {
    item.filename = item.href.split("/").pop() as string;
  });
  return list;
}

export async function listLocalBackup() {
  return invoke<ILocalBackupFile[]>("list_local_backup");
}

export async function scriptValidateNotice(status: string, msg: string) {
  return invoke<void>("script_validate_notice", { status, msg });
}

export async function validateScriptFile(filePath: string) {
  return invoke<boolean>("validate_script_file", { filePath });
}

// 获取当前运行模式
export const getRunningMode = async () => {
  return invoke<string>("get_running_mode");
};

// 获取应用运行时间
export const getAppUptime = async () => {
  return invoke<number>("get_app_uptime");
};

// 安装系统服务
export const installService = async () => {
  return invoke<void>("install_service");
};

// 卸载系统服务
export const uninstallService = async () => {
  return invoke<void>("uninstall_service");
};

// 重装系统服务
export const reinstallService = async () => {
  return invoke<void>("reinstall_service");
};

// 修复系统服务
export const repairService = async () => {
  return invoke<void>("repair_service");
};

// 系统服务是否可用
export const isServiceAvailable = async () => {
  try {
    return await invoke<boolean>("is_service_available");
  } catch (error) {
    console.error("Service check failed:", error);
    return false;
  }
};
export const entry_lightweight_mode = async () => {
  return invoke<void>("entry_lightweight_mode");
};

export const exit_lightweight_mode = async () => {
  return invoke<void>("exit_lightweight_mode");
};

export const isAdmin = async () => {
  try {
    return await invoke<boolean>("app_is_admin");
  } catch (error) {
    console.error("检查管理员权限失败:", error);
    return false;
  }
};

export async function getNextUpdateTime(uid: string) {
  return invoke<number | null>("get_next_update_time", { uid });
}

export const isPortInUse = async (port: number) => {
  try {
    return await invoke<boolean>("is_port_in_use", { port });
  } catch (error) {
    console.error("检查端口使用状态失败:", error);
    return false;
  }
};
