import { getVergeConfig, patchVergeConfig } from "@/services/cmds";
import useSWR from "swr";

export const useVerge = () => {
  const { data: verge, mutate: mutateVerge } = useSWR(
    "getVergeConfig",
    async () => {
      const data = await getVergeConfig();
      if (data.theme_mode === "dark") {
        data.theme_setting = data.dark_theme_setting;
      } else {
        data.theme_setting = data.light_theme_setting;
      }
      return data;
    },
  );

  const patchVerge = async (value: Partial<IVergeConfig>) => {
    await patchVergeConfig(value);
    mutateVerge();
  };

  const patchVergeTheme = async (value: Partial<IVergeConfig>) => {
    await patchVergeConfig({
      light_theme_setting: value.light_theme_setting,
      dark_theme_setting: value.dark_theme_setting,
    });
    mutateVerge();
  };

  return {
    verge,
    mutateVerge,
    patchVerge,
    patchVergeTheme,
  };
};
