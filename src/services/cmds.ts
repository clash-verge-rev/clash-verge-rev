import { invoke } from "@tauri-apps/api/tauri";
import { ApiType, CmdType } from "./types";

export async function getProfiles() {
  return invoke<CmdType.ProfilesConfig>("get_profiles");
}

export async function syncProfiles() {
  return invoke<void>("sync_profiles");
}

export async function importProfile(url: string) {
  return invoke<void>("import_profile", { url });
}

export async function updateProfile(index: number) {
  return invoke<void>("update_profile", { index });
}

export async function deleteProfile(index: number) {
  return invoke<void>("delete_profile", { index });
}

export async function patchProfile(
  index: number,
  profile: CmdType.ProfileItem
) {
  return invoke<void>("patch_profile", { index, profile });
}

export async function selectProfile(index: number) {
  return invoke<void>("select_profile", { index });
}

export async function restartSidecar() {
  return invoke<void>("restart_sidecar");
}

export async function getClashInfo() {
  return invoke<CmdType.ClashInfo | null>("get_clash_info");
}

export async function patchClashConfig(payload: Partial<ApiType.ConfigData>) {
  return invoke<void>("patch_clash_config", { payload });
}

export async function setSysProxy(enable: boolean) {
  return invoke<void>("set_sys_proxy", { enable });
}

export async function getVergeConfig() {
  return invoke<CmdType.VergeConfig>("get_verge_config");
}

export async function patchVergeConfig(payload: CmdType.VergeConfig) {
  return invoke<void>("patch_verge_config", { payload });
}
