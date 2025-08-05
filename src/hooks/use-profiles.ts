import useSWR, { mutate } from "swr";
import {
  getProfiles,
  patchProfile,
  patchProfilesConfig,
  forceRefreshProxies,
} from "@/services/cmds";
import { getProxies, updateProxy } from "@/services/cmds";

export const useProfiles = () => {
  const {
    data: profiles,
    mutate: mutateProfiles,
    error,
    isValidating,
  } = useSWR("getProfiles", getProfiles, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 500, // 减少去重时间，提高响应性
    errorRetryCount: 3,
    errorRetryInterval: 1000,
    refreshInterval: 0, // 完全由手动控制
    onError: (error) => {
      console.error("[useProfiles] SWR错误:", error);
    },
    onSuccess: (data) => {
      console.log(
        "[useProfiles] 配置数据更新成功，配置数量:",
        data?.items?.length || 0,
      );
    },
  });

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
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      await mutateProfiles();
      throw error;
    }
  };

  const patchCurrent = async (value: Partial<IProfileItem>) => {
    if (profiles?.current) {
      await patchProfile(profiles.current, value);
      mutateProfiles();
    }
  };

  // 根据selected的节点选择
  const activateSelected = async () => {
    try {
      console.log("[ActivateSelected] 开始处理代理选择");

      const [proxiesData, profileData] = await Promise.all([
        getProxies(),
        getProfiles(),
      ]);

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

      // 检查是否有saved的代理选择
      const { selected = [] } = current;
      if (selected.length === 0) {
        console.log("[ActivateSelected] 当前profile无保存的代理选择，跳过");
        return;
      }

      console.log(
        `[ActivateSelected] 当前profile有 ${selected.length} 个代理选择配置`,
      );

      const selectedMap = Object.fromEntries(
        selected.map((each) => [each.name!, each.now!]),
      );

      let hasChange = false;
      const newSelected: typeof selected = [];
      const { global, groups } = proxiesData;

      // 处理所有代理组
      [global, ...groups].forEach(({ type, name, now }) => {
        if (!now || type !== "Selector") {
          if (selectedMap[name] != null) {
            newSelected.push({ name, now: now || selectedMap[name] });
          }
          return;
        }

        const targetProxy = selectedMap[name];
        if (targetProxy != null && targetProxy !== now) {
          console.log(
            `[ActivateSelected] 需要切换代理组 ${name}: ${now} -> ${targetProxy}`,
          );
          hasChange = true;
          updateProxy(name, targetProxy);
        }

        newSelected.push({ name, now: targetProxy || now });
      });

      if (!hasChange) {
        console.log("[ActivateSelected] 所有代理选择已经是目标状态，无需更新");
        return;
      }

      console.log(`[ActivateSelected] 完成代理切换，保存新的选择配置`);

      try {
        await patchProfile(profileData.current!, { selected: newSelected });
        console.log("[ActivateSelected] 代理选择配置保存成功");

        // 切换节点后强制刷新后端缓存
        await forceRefreshProxies();

        setTimeout(() => {
          mutate("getProxies", getProxies());
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
    current: profiles?.items?.find((p) => p && p.uid === profiles.current),
    activateSelected,
    patchProfiles,
    patchCurrent,
    mutateProfiles,
    // 新增故障检测状态
    isLoading: isValidating,
    error,
    isStale: !profiles && !error && !isValidating, // 检测是否处于异常状态
  };
};
