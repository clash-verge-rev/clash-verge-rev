import useSWR, { mutate } from "swr";
import { selectNodeForGroup } from "tauri-plugin-mihomo-api";

import {
  getProfiles,
  patchProfile,
  patchProfilesConfig,
  calcuProxies,
} from "@/services/cmds";
import {
  useProfileStore,
  selectEffectiveProfiles,
  selectIsHydrating,
  selectLastResult,
} from "@/stores/profile-store";

export const useProfiles = () => {
  const profilesFromStore = useProfileStore(selectEffectiveProfiles);
  const storeHydrating = useProfileStore(selectIsHydrating);
  const lastResult = useProfileStore(selectLastResult);
  const commitProfileSnapshot = useProfileStore(
    (state) => state.commitHydrated,
  );

  const {
    data: swrProfiles,
    mutate: mutateProfiles,
    error,
    isValidating,
  } = useSWR("getProfiles", getProfiles, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 500,
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    refreshInterval: 0,
    onError: (err) => {
      console.error("[useProfiles] SWR错误:", err);
    },
    onSuccess: (data) => {
      commitProfileSnapshot(data);
      console.log(
        "[useProfiles] 配置数据更新成功，配置数量",
        data?.items?.length || 0,
      );
    },
  });

  const rawProfiles = profilesFromStore ?? swrProfiles;
  const profiles = (rawProfiles ?? {
    current: null,
    items: [],
  }) as IProfilesConfig;
  const hasProfiles = rawProfiles != null;

  const patchProfiles = async (
    value: Partial<IProfilesConfig>,
    signal?: AbortSignal,
  ) => {
    try {
      if (signal?.aborted) {
        throw new DOMException("Operation was aborted", "AbortError");
      }
      const success = await patchProfilesConfig(value);

      if (signal?.aborted) {
        throw new DOMException("Operation was aborted", "AbortError");
      }

      await mutateProfiles();

      return success;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }

      await mutateProfiles();
      throw err;
    }
  };

  const patchCurrent = async (value: Partial<IProfileItem>) => {
    if (!hasProfiles || !profiles.current) {
      return;
    }
    await patchProfile(profiles.current, value);
    mutateProfiles();
  };

  const activateSelected = async () => {
    try {
      console.log("[ActivateSelected] 开始处理代理选择");

      const proxiesData = await calcuProxies();
      const profileData = hasProfiles ? profiles : null;

      if (!profileData || !proxiesData) {
        console.log("[ActivateSelected] 代理或配置数据不可用，跳过处理");
        return;
      }

      const current = profileData.items?.find(
        (e) => e && e.uid === profileData.current,
      );

      if (!current) {
        console.log("[ActivateSelected] 未找到当前profile配置");
        return;
      }

      const { selected = [] } = current;
      if (selected.length === 0) {
        console.log("[ActivateSelected] 当前profile无保存的代理选择，跳过");
        return;
      }

      console.log(
        `[ActivateSelected] 当前profile有${selected.length} 个代理选择配置`,
      );

      const selectedMap = Object.fromEntries(
        selected.map((each) => [each.name!, each.now!]),
      );

      let hasChange = false;
      const newSelected: typeof selected = [];
      const { global, groups } = proxiesData;
      const selectableTypes = new Set([
        "Selector",
        "URLTest",
        "Fallback",
        "LoadBalance",
      ]);

      [global, ...groups].forEach((group) => {
        if (!group) {
          return;
        }

        const { type, name, now } = group;
        const savedProxy = selectedMap[name];
        const availableProxies = Array.isArray(group.all) ? group.all : [];

        if (!selectableTypes.has(type)) {
          if (savedProxy != null || now != null) {
            const preferredProxy = now ? now : savedProxy;
            newSelected.push({ name, now: preferredProxy });
          }
          return;
        }

        if (savedProxy == null) {
          if (now != null) {
            newSelected.push({ name, now });
          }
          return;
        }

        const existsInGroup = availableProxies.some((proxy) => {
          if (typeof proxy === "string") {
            return proxy === savedProxy;
          }

          return proxy?.name === savedProxy;
        });

        if (!existsInGroup) {
          console.warn(
            `[ActivateSelected] 保存的代理${savedProxy} 不存在于代理组${name}`,
          );
          hasChange = true;
          newSelected.push({ name, now: now ?? savedProxy });
          return;
        }

        if (savedProxy !== now) {
          console.log(
            `[ActivateSelected] 需要切换代理组 ${name}: ${now} -> ${savedProxy}`,
          );
          hasChange = true;
          selectNodeForGroup(name, savedProxy);
        }

        newSelected.push({ name, now: savedProxy });
      });

      if (!hasChange) {
        console.log("[ActivateSelected] 所有代理选择已经是目标状态，无需更新");
        return;
      }

      console.log("[ActivateSelected] 完成代理切换，保存新的选择配置");

      try {
        await patchProfile(profileData.current!, { selected: newSelected });
        console.log("[ActivateSelected] 代理选择配置保存成功");

        setTimeout(() => {
          mutate("getProxies", calcuProxies());
        }, 100);
      } catch (error: any) {
        console.error(
          "[ActivateSelected] 保存代理选择配置失败:",
          error.message,
        );
      }
    } catch (error: any) {
      console.error("[ActivateSelected] 处理代理选择失败:", error.message);
    }
  };

  return {
    profiles,
    hasProfiles,
    current: hasProfiles
      ? (profiles.items?.find((p) => p && p.uid === profiles.current) ?? null)
      : null,
    activateSelected,
    patchProfiles,
    patchCurrent,
    mutateProfiles,
    isLoading: isValidating || storeHydrating,
    isHydrating: storeHydrating,
    lastResult,
    error,
    isStale: !hasProfiles && !error && !isValidating,
  };
};
