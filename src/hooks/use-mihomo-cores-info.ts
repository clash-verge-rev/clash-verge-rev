import {
  checkPermissionsGranted,
  refreshPermissionsGranted,
} from "@/services/cmds";
import { useEffect } from "react";
import getSystem from "@/utils/get-system";
import { useService } from "./use-service";
import { Command } from "@tauri-apps/plugin-shell";
import { useVerge } from "./use-verge";
import { usePortable } from "./use-portable";
import useSWR from "swr";

type MihomoCoreInfo = {
  name: string;
  core: string;
  version: string;
  permissionsGranted: boolean;
};

const defaultValue: MihomoCoreInfo[] = [
  {
    name: "Mihomo",
    core: "verge-mihomo",
    version: "",
    permissionsGranted: false,
  },
  {
    name: "Mihomo Alpha",
    core: "verge-mihomo-alpha",
    version: "",
    permissionsGranted: false,
  },
];

const MIHOMO_CORES = ["verge-mihomo", "verge-mihomo-alpha"];
const OS = getSystem();

export const useMihomoCoresInfo = () => {
  const { serviceStatus } = useService();
  const {
    verge: { clash_core = "verge-mihomo" },
  } = useVerge();
  const serviceUnavailable =
    serviceStatus === "uninstall" || serviceStatus === "unknown";

  const { portable } = usePortable();
  const isLinuxPortable = portable && OS === "linux";

  const enableGrantPermissions = isLinuxPortable && serviceUnavailable;

  const { data: mihomoCoresInfo, mutate: muteMihomoCoresInfo } = useSWR(
    "getMihomoCoresInfo",
    async () => {
      let res = defaultValue;
      res = await refreshMihomoVersion(res);
      res = await refreshMihomoPermissions(res);
      return res;
    },
    { fallbackData: defaultValue },
  );

  useEffect(() => {
    muteMihomoCoresInfo();
  }, [enableGrantPermissions, clash_core, portable]);

  const refreshMihomoVersion = async (coresInfo: MihomoCoreInfo[]) => {
    for (let core of MIHOMO_CORES) {
      const output = await Command.sidecar(`sidecar/${core}`, ["-v"]).execute();
      if (output.code === 0) {
        const regex = /(alpha-\w+|v\d+(?:\.\d+)*)/gm;
        const version = output.stdout.match(regex)?.[0];
        if (version) {
          coresInfo = coresInfo.map((c) =>
            c.core === core ? { ...c, version } : c,
          );
        }
      }
    }
    return coresInfo;
  };

  const refreshMihomoPermissions = async (coresInfo: MihomoCoreInfo[]) => {
    if (enableGrantPermissions) {
      await refreshPermissionsGranted();
      for (let core of MIHOMO_CORES) {
        const granted = await checkPermissionsGranted(core);
        coresInfo = coresInfo.map((c) =>
          c.core === core ? { ...c, permissionsGranted: granted } : c,
        );
      }
    }
    return coresInfo;
  };

  return {
    mihomoCoresInfo,
    enableGrantPermissions,
    muteMihomoCoresInfo,
  };
};
