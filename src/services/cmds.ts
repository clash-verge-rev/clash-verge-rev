import { invoke } from "@tauri-apps/api/tauri";
import { ApiType, CmdType } from "./types";

export async function restartSidecar() {
  return invoke<void>("restart_sidecar");
}

export async function getClashInfo() {
  return invoke<CmdType.ClashInfo | null>("get_clash_info");
}

export async function patchClashConfig(payload: Partial<ApiType.ConfigData>) {
  return invoke<void>("patch_clash_config", { payload });
}

export async function importProfile(url: string) {
  return invoke<void>("import_profile", { url });
}

export async function updateProfile(index: number) {
  return invoke<void>("update_profile", { index });
}

export async function getProfiles() {
  return (await invoke<CmdType.ProfilesConfig>("get_profiles")) ?? {};
}

export async function setProfiles(index: number, profile: CmdType.ProfileItem) {
  return invoke<void>("set_profiles", { index, profile });
}

export async function putProfiles(current: number) {
  return invoke<void>("put_profiles", { current });
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
