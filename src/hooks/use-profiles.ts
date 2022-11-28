import useSWR from "swr";
import {
  getProfiles,
  patchProfile,
  patchProfilesConfig,
} from "@/services/cmds";

export const useProfiles = () => {
  const { data: profiles, mutate: mutateProfiles } = useSWR(
    "getProfiles",
    getProfiles
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

  return {
    profiles,
    current: profiles?.items?.find((p) => p.uid === profiles.current),
    patchProfiles,
    patchCurrent,
    mutateProfiles,
  };
};
