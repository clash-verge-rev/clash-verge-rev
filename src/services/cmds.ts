import { invoke } from "@tauri-apps/api/tauri";
import { ApiType, CmdType } from "./types";

export async function getProfiles() {
  return invoke<CmdType.ProfilesConfig>("get_profiles");
}

export async function syncProfiles() {
  return invoke<void>("sync_profiles");
}

export async function enhanceProfiles() {
  return invoke<void>("enhance_profiles");
}

export async function createProfile(item: Partial<CmdType.ProfileItem>) {
  return invoke<void>("create_profile", { item });
}

export async function viewProfile(index: string) {
  return invoke<void>("view_profile", { index });
}

export async function importProfile(url: string) {
  return invoke<void>("import_profile", { url, withProxy: true });
}

export async function updateProfile(index: string, withProxy: boolean) {
  return invoke<void>("update_profile", { index, withProxy });
}

export async function deleteProfile(index: string) {
  return invoke<void>("delete_profile", { index });
}

export async function patchProfile(
  index: string,
  profile: CmdType.ProfileItem
) {
  return invoke<void>("patch_profile", { index, profile });
}

export async function selectProfile(index: string) {
  return invoke<void>("select_profile", { index });
}

export async function changeProfileChain(chain?: string[]) {
  return invoke<void>("change_profile_chain", { chain });
}

export async function getClashInfo() {
  return invoke<CmdType.ClashInfo | null>("get_clash_info");
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
  return invoke<any>("get_sys_proxy");
}

export async function restartSidecar() {
  return invoke<void>("restart_sidecar");
}

export async function killSidecars() {
  return invoke<any>("kill_sidecars");
}

export async function openAppDir() {
  return invoke<void>("open_app_dir");
}

export async function openLogsDir() {
  return invoke<void>("open_logs_dir");
}
