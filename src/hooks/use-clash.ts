import useSWR, { mutate } from "swr";
import { useLockFn } from "ahooks";
import {
  getAxios,
  getClashConfig,
  getVersion,
  updateConfigs,
} from "@/services/api";
import { getClashInfo, patchClashConfig } from "@/services/cmds";

export const useClash = () => {
  const { data: clash, mutate: mutateClash } = useSWR(
    "getClashConfig",
    getClashConfig
  );

  const { data: versionData, mutate: mutateVersion } = useSWR(
    "getVersion",
    getVersion
  );

  const patchClash = useLockFn(async (patch: Partial<IConfigData>) => {
    await updateConfigs(patch);
    await patchClashConfig(patch);
    mutateClash();
  });

  const version = versionData?.premium
    ? `${versionData.version} Premium`
    : versionData?.meta
    ? `${versionData.version} Meta`
    : versionData?.version || "-";

  return {
    clash,
    version,
    mutateClash,
    mutateVersion,
    patchClash,
  };
};

export const useClashInfo = () => {
  const { data: clashInfo, mutate: mutateInfo } = useSWR(
    "getClashInfo",
    getClashInfo
  );

  const patchInfo = async (
    patch: Partial<
      Pick<IConfigData, "mixed-port" | "external-controller" | "secret">
    >
  ) => {
    const hasInfo =
      patch["mixed-port"] != null ||
      patch["external-controller"] != null ||
      patch.secret != null;

    if (!hasInfo) return;

    if (patch["mixed-port"]) {
      const port = patch["mixed-port"];
      if (port < 1000) {
        throw new Error("The port should not < 1000");
      }
      if (port > 65536) {
        throw new Error("The port should not > 65536");
      }
    }

    await patchClashConfig(patch);
    mutateInfo();
    mutate("getClashConfig");
    // 刷新接口
    getAxios(true);
  };

  return {
    clashInfo,
    mutateInfo,
    patchInfo,
  };
};
