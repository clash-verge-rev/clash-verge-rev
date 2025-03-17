import dayjs from "dayjs";
import { invoke } from "@tauri-apps/api/core";
import { Notice } from "@/components/base";

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
  return invoke<void>("patch_profiles_config", { profiles });
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

export async function importProfile(url: string) {
  return invoke<void>("import_profile", {
    url,
    option: { with_proxy: true },
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

export async function patchClashConfig(payload: Partial<IConfigData>) {
  return invoke<void>("patch_clash_config", { payload });
}

export async function patchClashMode(payload: String) {
  return invoke<void>("patch_clash_mode", { payload });
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
  return invoke<{
    enable: boolean;
    url: string;
  }>("get_auto_proxy");
}

export async function getAutoLaunchStatus() {
  try {
    return await invoke<boolean>("get_auto_launch_status");
  } catch (error) {
    console.error("获取自启动状态失败:", error);
    // 出错时返回false作为默认值
    return false;
  }
}

export async function changeClashCore(clashCore: string) {
  return invoke<string | null>("change_clash_core", { clashCore });
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
  return invoke<void>("open_app_dir").catch((err) =>
    Notice.error(err?.message || err.toString(), 1500),
  );
}

export async function openCoreDir() {
  return invoke<void>("open_core_dir").catch((err) =>
    Notice.error(err?.message || err.toString(), 1500),
  );
}

export async function openLogsDir() {
  return invoke<void>("open_logs_dir").catch((err) =>
    Notice.error(err?.message || err.toString(), 1500),
  );
}

export async function openWebUrl(url: string) {
  return invoke<void>("open_web_url", { url });
}

export async function cmdGetProxyDelay(
  name: string,
  timeout: number,
  url?: string,
) {
  // 确保URL不为空
  const testUrl = url || "http://cp.cloudflare.com/generate_204";
  console.log(
    `[API] 调用延迟测试API，代理: ${name}, 超时: ${timeout}ms, URL: ${testUrl}`,
  );

  try {
    name = encodeURIComponent(name);
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
      console.log(
        `[API] 延迟测试API调用成功，代理: ${name}, 延迟: ${result.delay}ms`,
      );
      return result;
    } else {
      console.error(
        `[API] 延迟测试API返回无效结果，代理: ${name}, 结果:`,
        result,
      );
      // 返回一个有效的结果对象，但标记为超时
      return { delay: 1e6 };
    }
  } catch (error) {
    console.error(`[API] 延迟测试API调用失败，代理: ${name}`, error);
    // 返回一个有效的结果对象，但标记为错误
    return { delay: 1e6 };
  }
}

export async function cmdTestDelay(url: string) {
  return invoke<number>("test_delay", { url });
}

export async function invoke_uwp_tool() {
  return invoke<void>("invoke_uwp_tool").catch((err) =>
    Notice.error(err?.message || err.toString(), 1500),
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

export async function getNetworkInterfacesInfo() {
  return invoke<INetworkInterface[]>("get_network_interfaces_info");
}

export async function createWebdavBackup() {
  return invoke<void>("create_webdav_backup");
}

export async function deleteWebdavBackup(filename: string) {
  return invoke<void>("delete_webdav_backup", { filename });
}

export async function restoreWebDavBackup(filename: string) {
  return invoke<void>("restore_webdav_backup", { filename });
}

export async function saveWebdavConfig(
  url: string,
  username: string,
  password: String,
) {
  return invoke<void>("save_webdav_config", {
    url,
    username,
    password,
  });
}

export async function listWebDavBackup() {
  let list: IWebDavFile[] = await invoke<IWebDavFile[]>("list_webdav_backup");
  list.map((item) => {
    item.filename = item.href.split("/").pop() as string;
  });
  return list;
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

// 安装/重装系统服务
export const installService = async () => {
  return invoke<void>("install_service");
};
