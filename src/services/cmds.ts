import { invoke } from "@tauri-apps/api/tauri";
import Notice from "@/components/base/base-notice";

export async function getClashLogs() {
  const regex = /time="(.+?)"\s+level=(.+?)\s+msg="(.+?)"/;
  const newRegex = /(.+?)\s+(.+?)\s+(.+)/;
  const logs = await invoke<string[]>("get_clash_logs");

  return logs
    .map((log) => {
      const result = log.match(regex);
      if (result) {
        const [_, time, type, payload] = result;
        return { time, type, payload };
      }

      const result2 = log.match(newRegex);
      if (result2) {
        const [_, time, type, payload] = result2;
        return { time, type, payload };
      }
      return null;
    })
    .filter(Boolean) as ApiType.LogItem[];
}

export async function getProfiles() {
  return invoke<CmdType.ProfilesConfig>("get_profiles");
}

export async function enhanceProfiles() {
  return invoke<void>("enhance_profiles");
}

export async function createProfile(
  item: Partial<CmdType.ProfileItem>,
  fileData?: string | null
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

export async function updateProfile(
  index: string,
  option?: CmdType.ProfileOption
) {
  return invoke<void>("update_profile", { index, option });
}

export async function deleteProfile(index: string) {
  return invoke<void>("delete_profile", { index });
}

export async function patchProfile(
  index: string,
  profile: Partial<CmdType.ProfileItem>
) {
  return invoke<void>("patch_profile", { index, profile });
}

export async function selectProfile(index: string) {
  return invoke<void>("select_profile", { index });
}

export async function changeProfileChain(chain?: string[]) {
  return invoke<void>("change_profile_chain", { chain });
}

export async function changeProfileValid(valid?: string[]) {
  return invoke<void>("change_profile_valid", { valid });
}

export async function getClashInfo() {
  return invoke<CmdType.ClashInfo | null>("get_clash_info");
}

export async function getRuntimeConfig() {
  return invoke<any | null>("get_runtime_config");
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

export async function patchClashConfig(payload: Partial<ApiType.ConfigData>) {
  return invoke<void>("patch_clash_config", { payload });
}

export async function getVergeConfig() {
  return invoke<CmdType.VergeConfig>("get_verge_config");
}

export async function patchVergeConfig(payload: CmdType.VergeConfig) {
  return invoke<void>("patch_verge_config", { payload });
}

export async function getSystemProxy() {
  return invoke<{
    enable: boolean;
    server: string;
    bypass: string;
  }>("get_sys_proxy");
}

export async function changeClashCore(clashCore: string) {
  return invoke<any>("change_clash_core", { clashCore });
}

export async function restartSidecar() {
  return invoke<void>("restart_sidecar");
}

export async function killSidecar() {
  return invoke<any>("kill_sidecar");
}

export async function openAppDir() {
  return invoke<void>("open_app_dir").catch((err) =>
    Notice.error(err?.message || err.toString(), 1500)
  );
}

export async function openLogsDir() {
  return invoke<void>("open_logs_dir").catch((err) =>
    Notice.error(err?.message || err.toString(), 1500)
  );
}

export async function openWebUrl(url: string) {
  return invoke<void>("open_web_url", { url });
}

/// service mode

export async function startService() {
  return invoke<void>("start_service");
}

export async function stopService() {
  return invoke<void>("stop_service");
}

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
