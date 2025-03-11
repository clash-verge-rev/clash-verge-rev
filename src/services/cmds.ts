import { Notice } from "@/components/base";
import { LogMessage } from "@/components/profile/profile-more";
import getSystem from "@/utils/get-system";
import { invoke } from "@tauri-apps/api/core";
import dayjs from "dayjs";

export interface MergeResult {
  config: string;
  logs: Record<string, LogMessage[]>;
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

export async function getProfiles() {
  return invoke<IProfilesConfig>("get_profiles");
}

export async function getProfile(uid: string) {
  return invoke<IProfileItem>("get_profile", { uid });
}

export async function getChains(profileUid: string | null) {
  return invoke<IProfileItem[]>("get_chains", { profileUid });
}

export async function getTemplate(scope: string, language: string) {
  return invoke<string>("get_template", { scope, language });
}

export async function getDefaultBypass() {
  return invoke<string>("get_default_bypass");
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

export async function getCurrentProfileRuleProvidersPath() {
  return invoke<Record<string, string>>("get_current_profile_rule_providers");
}

export async function saveProfileFile(uid: string, fileData: string) {
  return invoke<void>("save_profile_file", { uid, fileData });
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

export async function deleteProfile(uid: string) {
  return invoke<void>("delete_profile", { uid });
}

export async function patchProfile(
  uid: string,
  profile: Partial<IProfileItem>,
) {
  return invoke<void>("patch_profile", { uid, profile });
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
  const res = await invoke<Record<string, LogMessage[]>>("get_runtime_logs");
  const list = Object.entries(res);
  list.map((item) => {
    const profileUid = item[0];
    const logs = item[1];
    logs.forEach((logsItem) => {
      const newData = logsItem.data.map((i) => {
        try {
          const jsonData = JSON.parse(i);
          return jsonData;
        } catch (err) {
          return i;
        }
      });
      logsItem.data = newData;
    });
    res[profileUid] = logs;
  });
  return res;
}

export async function getPreMergeResult(
  profileUid: string | null,
  modifiedUid: string,
) {
  const res = await invoke<MergeResult>("get_pre_merge_result", {
    profileUid,
    modifiedUid,
  });
  if (res.logs[modifiedUid]) {
    res.logs[modifiedUid].map((item) => {
      const newData = item.data.map((i) => {
        try {
          const jsonData = JSON.parse(i);
          return jsonData;
        } catch (err) {
          return i;
        }
      });
      item.data = newData;
    });
  }
  return res;
}

export async function testMergeChain(
  profileUid: string | null,
  modifiedUid: string,
  content: string,
) {
  const res = await invoke<MergeResult>("test_merge_chain", {
    profileUid,
    modifiedUid,
    content,
  });
  if (res.logs[modifiedUid]) {
    res.logs[modifiedUid].map((item) => {
      const newData = item.data.map((i) => {
        try {
          const jsonData = JSON.parse(i);
          return jsonData;
        } catch (err) {
          return i;
        }
      });
      item.data = newData;
    });
  }
  return res;
}

export async function patchClashConfig(payload: Partial<IConfigData>) {
  return invoke<void>("patch_clash_config", { payload });
}

export async function checkPortAvailable(port: number) {
  return invoke<boolean>("check_port_available", { port });
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

export async function changeClashCore(clashCore: string) {
  return invoke<any>("change_clash_core", { clashCore });
}

export async function restartSidecar() {
  return invoke<void>("restart_sidecar");
}

export async function grantPermission(core: string) {
  return invoke<void>("grant_permission", { core });
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

export async function cmdTestDelay(url: string) {
  return invoke<number>("test_delay", { url });
}

/// service mode
export async function checkService() {
  try {
    const result = await invoke<any>("check_service");
    if (result?.code === 0) return "active";
    if (result?.code === 400) return "installed";
    return "unknown";
  } catch (err: any) {
    return "uninstall";
  }
}

export async function installService() {
  return invoke<void>("install_service");
}

export async function uninstallService() {
  return invoke<void>("uninstall_service");
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

export async function restartApp() {
  return invoke("restart_app");
}

export async function copyIconFile(
  path: string,
  name: "common" | "sysproxy" | "tun",
) {
  return invoke<void>("copy_icon_file", { path, name });
}

export async function downloadIconCache(url: string, name: string) {
  return invoke<string>("download_icon_cache", { url, name });
}

// web dav
export async function updateWebDavInfo(
  url: string,
  username: string,
  password: string,
) {
  return invoke<void>("update_webdav_info", { url, username, password });
}

export async function createLocalBackup(onlyBackupProfiles = false) {
  return invoke<string[]>("create_local_backup", { onlyBackupProfiles });
}

export async function applyLocalBackup(filePath: string) {
  return invoke<void>("apply_local_backup", { filePath });
}

export async function createAndUploadBackup(onlyBackupProfiles = false) {
  return invoke<void>("create_and_upload_backup", { onlyBackupProfiles });
}

export async function listBackup() {
  let list: IWebDavFile[] = await invoke<IWebDavFile[]>("list_backup");
  list.map((item) => {
    item.filename = item.href.split("/").pop() as string;
  });
  return list;
}

export async function downloadBackupAndReload(fileName: string) {
  return invoke<void>("download_backup_and_reload", { fileName });
}

export async function deleteBackup(fileName: string) {
  return invoke<void>("delete_backup", { fileName });
}

export async function isWayland() {
  const OS = getSystem();
  if (OS !== "linux") return false;
  return invoke<boolean>("is_wayland");
}
