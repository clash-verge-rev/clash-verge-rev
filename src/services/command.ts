import { invoke } from "@tauri-apps/api/tauri";

export async function restartSidecar() {
  return invoke<void>("restart_sidebar");
}

export interface ClashInfo {
  status: string;
  controller?: { server?: string; secret?: string };
  message?: string;
}

export async function getClashInfo() {
  return invoke<ClashInfo | null>("get_clash_info");
}

export async function importProfile(url: string) {
  return invoke<string>("import_profile", { url });
}

export interface ProfileItem {
  name?: string;
  file?: string;
  mode?: string;
  url?: string;
  selected?: { name?: string; now?: string }[];
  extra?: {
    upload: number;
    download: number;
    total: number;
    expire: number;
  };
}

export interface ProfilesConfig {
  current?: number;
  items?: ProfileItem[];
}

export async function getProfiles() {
  return invoke<ProfilesConfig | null>("get_profiles");
}

export async function setProfiles(current: number, profile: ProfileItem) {
  return invoke<void>("set_profiles", { current, profile });
}

export async function putProfiles(current: number) {
  return invoke<void>("put_profiles", { current });
}
