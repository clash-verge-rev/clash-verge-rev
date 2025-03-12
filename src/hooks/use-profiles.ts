import { calcuProxies } from "@/services/api";
import {
  getProfiles,
  patchProfile,
  patchProfilesConfig,
} from "@/services/cmds";
import useSWR, { mutate } from "swr";
import { selectNodeForProxy } from "tauri-plugin-mihomo-api";

export const useProfiles = () => {
  const { data: profiles, mutate: mutateProfiles } = useSWR(
    "getProfiles",
    getProfiles,
  );

  const patchProfiles = async (value: Partial<IProfilesConfig>) => {
    await patchProfilesConfig(value);
    mutateProfiles();
  };

  const patchCurrent = async (value: Partial<IProfileItem>) => {
    if (profiles?.current) {
      await patchProfile(profiles.current, value);
      mutateProfiles();
    }
  };

  // 根据 selected 的节点选择
  const activateSelected = async () => {
    const proxiesData = await calcuProxies();
    const profileData = await getProfiles();

    if (!profileData || !proxiesData) return;

    const current = profileData.items?.find(
      (e) => e && e.uid === profileData.current,
    );

    if (!current) return;

    // init selected array
    const { selected = [] } = current;
    const selectedMap = Object.fromEntries(
      selected.map((each) => [each.name!, each.now!]),
    );

    let hasChange = false;

    const newSelected: typeof selected = [];
    const { global, groups } = proxiesData;

    for (const item of [global, ...groups]) {
      const { type, name, now } = item;
      if (!now || type !== "Selector") return;
      if (selectedMap[name] != null && selectedMap[name] !== now) {
        hasChange = true;
        await selectNodeForProxy(name, selectedMap[name]);
      }
      newSelected.push({ name, now: selectedMap[name] });
    }

    if (hasChange) {
      patchProfile(profileData.current!, { selected: newSelected });
      mutate("getProxies", calcuProxies());
    }
  };

  return {
    profiles,
    current: profiles?.items?.find((p) => p && p.uid === profiles.current),
    activateSelected,
    patchProfiles,
    patchCurrent,
    mutateProfiles,
  };
};
