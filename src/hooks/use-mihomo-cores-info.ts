import {
  checkPermissionsGranted,
  refreshPermissionsGranted,
} from "@/services/cmds";
import { useEffect } from "react";
import getSystem from "@/utils/get-system";
import { useService } from "./use-service";
import { useSessionStorageState } from "ahooks";
import { Command } from "@tauri-apps/plugin-shell";
import { useVerge } from "./use-verge";
import { usePortable } from "./use-portable";

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

  const [mihomoCoresInfo, setMihomoCoresInfo] = useSessionStorageState<
    MihomoCoreInfo[]
  >("mihomo_cores_info", { defaultValue, listenStorageChange: true });

  useEffect(() => {
    refreshMihomoVersion().then(() => {
      refreshMihomoPermissions();
    });
  }, []);

  useEffect(() => {
    if (clash_core) {
      checkMihomoPermissionsGranted(clash_core);
    }
  }, [clash_core]);

  useEffect(() => {
    refreshMihomoPermissions();
  }, [portable]);

  const refreshMihomoVersion = async () => {
    for (let core of MIHOMO_CORES) {
      const output = await Command.sidecar(`sidecar/${core}`, ["-v"]).execute();
      if (output.code === 0) {
        const regex = /(alpha-\w+|v\d+(?:\.\d+)*)/gm;
        const version = output.stdout.match(regex)?.[0];
        if (version) {
          setMihomoCoresInfo((prev) => {
            if (prev) {
              return prev.map((c) => (c.core === core ? { ...c, version } : c));
            } else {
              return defaultValue.map((c) =>
                c.core === core ? { ...c, version } : c,
              );
            }
          });
        }
      }
    }
  };

  const checkMihomoPermissionsGranted = async (core: string) => {
    if (enableGrantPermissions) {
      const granted = await checkPermissionsGranted(core);
      setMihomoCoresInfo((prev) => {
        if (prev) {
          return prev.map((c) =>
            c.core === core ? { ...c, permissionsGranted: granted } : c,
          );
        } else {
          return defaultValue.map((c) =>
            c.core === core ? { ...c, permissionsGranted: granted } : c,
          );
        }
      });
    }
  };

  const refreshMihomoPermissions = async () => {
    if (enableGrantPermissions) {
      await refreshPermissionsGranted();
      for (let core of MIHOMO_CORES) {
        await checkMihomoPermissionsGranted(core);
      }
    }
  };

  return {
    mihomoCoresInfo,
    enableGrantPermissions,
    refreshMihomoVersion,
    refreshMihomoPermissions,
  };
};
