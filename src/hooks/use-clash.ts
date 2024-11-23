import useSWR, { mutate } from "swr";
import { useLockFn } from "ahooks";
import { getAxios, getVersion } from "@/services/api";
import {
  getClashInfo,
  patchClashConfig,
  getRuntimeConfig,
} from "@/services/cmds";

export const useClash = () => {
  const { data: clash, mutate: mutateClash } = useSWR(
    "getRuntimeConfig",
    getRuntimeConfig,
  );

  const { data: versionData, mutate: mutateVersion } = useSWR(
    "getVersion",
    getVersion,
  );

  const patchClash = useLockFn(async (patch: Partial<IConfigData>) => {
    await patchClashConfig(patch);
    mutateClash();
  });

  const version = versionData?.premium
    ? `${versionData.version} Premium`
    : versionData?.meta
      ? `${versionData.version} Mihomo`
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
    getClashInfo,
  );

  const patchInfo = async (
    patch: Partial<
      Pick<
        IConfigData,
        | "port"
        | "socks-port"
        | "mixed-port"
        | "redir-port"
        | "tproxy-port"
        | "external-controller"
        | "secret"
      >
    >,
  ) => {
    const hasInfo =
      patch["redir-port"] != null ||
      patch["tproxy-port"] != null ||
      patch["mixed-port"] != null ||
      patch["socks-port"] != null ||
      patch["port"] != null ||
      patch["external-controller"] != null ||
      patch.secret != null;

    if (!hasInfo) return;

    if (patch["redir-port"]) {
      const port = patch["redir-port"];
      if (port < 1000) {
        throw new Error("The port should not < 1000");
      }
      if (port > 65536) {
        throw new Error("The port should not > 65536");
      }
    }

    if (patch["tproxy-port"]) {
      const port = patch["tproxy-port"];
      if (port < 1000) {
        throw new Error("The port should not < 1000");
      }
      if (port > 65536) {
        throw new Error("The port should not > 65536");
      }
    }

    if (patch["mixed-port"]) {
      const port = patch["mixed-port"];
      if (port < 1000) {
        throw new Error("The port should not < 1000");
      }
      if (port > 65536) {
        throw new Error("The port should not > 65536");
      }
    }

    if (patch["socks-port"]) {
      const port = patch["socks-port"];
      if (port < 1000) {
        throw new Error("The port should not < 1000");
      }
      if (port > 65536) {
        throw new Error("The port should not > 65536");
      }
    }

    if (patch["port"]) {
      const port = patch["port"];
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
