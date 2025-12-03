import { useLockFn } from "ahooks";
import useSWR, { mutate } from "swr";
import { getVersion } from "tauri-plugin-mihomo-api";

import {
  getClashInfo,
  patchClashConfig,
  getRuntimeConfig,
} from "@/services/cmds";

const PORT_KEYS = [
  "port",
  "socks-port",
  "mixed-port",
  "redir-port",
  "tproxy-port",
] as const;

type ClashInfoPatch = Partial<
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
>;

const hasClashInfoPayload = (patch: ClashInfoPatch) =>
  PORT_KEYS.some((key) => patch[key] != null) ||
  patch["external-controller"] != null ||
  patch.secret != null;

const validatePortRange = (port: number) => {
  if (port < 1000) {
    throw new Error("The port should not < 1000");
  }
  if (port > 65536) {
    throw new Error("The port should not > 65536");
  }
};

const validatePorts = (patch: ClashInfoPatch) => {
  PORT_KEYS.forEach((key) => {
    const port = patch[key];
    if (!port) return;
    validatePortRange(port);
  });
};

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

  const version = versionData?.meta
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

  const patchInfo = async (patch: ClashInfoPatch) => {
    if (!hasClashInfoPayload(patch)) return;

    validatePorts(patch);

    await patchClashConfig(patch);
    mutateInfo();
    mutate("getClashConfig");
  };

  return {
    clashInfo,
    mutateInfo,
    patchInfo,
  };
};
