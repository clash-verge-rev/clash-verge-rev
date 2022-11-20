import useSWR from "swr";
import {
  getProfiles,
  patchProfile,
  patchProfilesConfig,
} from "@/services/cmds";

export const useProfiles = () => {
  const { data: profiles, mutate } = useSWR("getProfiles", getProfiles);

  const patchProfiles = async (value: Partial<IProfilesConfig>) => {
    await patchProfilesConfig(value);
    mutate();
  };

  const patchCurrent = async (value: Partial<IProfileItem>) => {
    if (profiles?.current) {
      await patchProfile(profiles.current, value);
      mutate();
    }
  };

  return {
    profiles,
    current: profiles?.items?.find((p) => p.uid === profiles.current),
    patchProfiles,
    patchCurrent,
  };
};
