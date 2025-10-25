import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  ClearRounded,
  ContentPasteRounded,
  LocalFireDepartmentRounded,
  RefreshRounded,
  TextSnippetOutlined,
  CheckBoxOutlineBlankRounded,
  CheckBoxRounded,
  IndeterminateCheckBoxRounded,
  DeleteRounded,
} from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import { Box, Button, Divider, Grid, IconButton, Stack } from "@mui/material";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useLockFn } from "ahooks";
import type { TFunction } from "i18next";
import { throttle } from "lodash-es";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import useSWR, { mutate } from "swr";
import { closeAllConnections } from "tauri-plugin-mihomo-api";

import { BasePage, DialogRef } from "@/components/base";
import { BaseStyledTextField } from "@/components/base/base-styled-text-field";
import { ProfileItem } from "@/components/profile/profile-item";
import { ProfileMore } from "@/components/profile/profile-more";
import {
  ProfileViewer,
  ProfileViewerRef,
} from "@/components/profile/profile-viewer";
import { ConfigViewer } from "@/components/setting/mods/config-viewer";
import { useListen } from "@/hooks/use-listen";
import { useProfiles } from "@/hooks/use-profiles";
import {
  createProfile,
  deleteProfile,
  enhanceProfiles,
  getProfiles,
  //restartCore,
  getRuntimeLogs,
  importProfile,
  reorderProfile,
  updateProfile,
} from "@/services/cmds";
import { showNotice } from "@/services/noticeService";
import { useSetLoadingCache, useThemeMode } from "@/services/states";

// 记录profile切换状态
const debugProfileSwitch = (action: string, profile: string, extra?: any) => {
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(
    `[Profile-Debug][${timestamp}] ${action}: ${profile}`,
    extra || "",
  );
};

type SwitchRequest = {
  profile: string;
  notifySuccess: boolean;
};

interface SwitchState {
  switching: SwitchRequest | null;
  queued: SwitchRequest | null;
  status: "idle" | "running";
  lastError: string | null;
}

type SwitchAction =
  | { type: "REQUEST"; payload: SwitchRequest }
  | { type: "RUN_FINISHED"; payload: { error?: string | null } };

const initialSwitchState: SwitchState = {
  switching: null,
  queued: null,
  status: "idle",
  lastError: null,
};

const switchReducer = (
  state: SwitchState,
  action: SwitchAction,
): SwitchState => {
  switch (action.type) {
    case "REQUEST": {
      const payload = action.payload;
      if (state.switching) {
        if (state.switching.profile === payload.profile) {
          const notifySuccess =
            state.switching.notifySuccess || payload.notifySuccess;
          return {
            ...state,
            switching: { profile: payload.profile, notifySuccess },
            lastError: null,
          };
        }
        return {
          ...state,
          queued: payload,
          lastError: null,
        };
      }

      return {
        switching: payload,
        queued: null,
        status: "running",
        lastError: null,
      };
    }
    case "RUN_FINISHED": {
      const nextError = action.payload.error ?? null;
      if (state.queued) {
        return {
          switching: state.queued,
          queued: null,
          status: "running",
          lastError: nextError,
        };
      }

      return {
        switching: null,
        queued: null,
        status: "idle",
        lastError: nextError,
      };
    }
    default:
      return state;
  }
};

interface ProfileSwitchControllerOptions {
  getCurrentProfileId: () => string | undefined;
  patchProfiles: (value: Partial<IProfilesConfig>) => Promise<void>;
  mutateLogs: () => Promise<void>;
  closeAllConnections: () => Promise<void>;
  activateSelected: () => Promise<void>;
  setActivatings: Dispatch<SetStateAction<string[]>>;
  t: TFunction;
}

const useProfileSwitchController = ({
  getCurrentProfileId,
  patchProfiles,
  mutateLogs,
  closeAllConnections,
  activateSelected,
  setActivatings,
  t,
}: ProfileSwitchControllerOptions) => {
  const [state, dispatch] = useReducer(switchReducer, initialSwitchState);
  const runningProfileRef = useRef<string | null>(null);

  const requestSwitch = useCallback(
    (profile: string, notifySuccess: boolean) => {
      const currentId = getCurrentProfileId();
      if (!notifySuccess && currentId === profile && state.status === "idle") {
        debugProfileSwitch("ALREADY_CURRENT_IGNORED", profile);
        return;
      }

      dispatch({ type: "REQUEST", payload: { profile, notifySuccess } });
    },
    [getCurrentProfileId, state.status],
  );

  useEffect(() => {
    if (state.status !== "running" || !state.switching) return;
    const { profile, notifySuccess } = state.switching;

    if (runningProfileRef.current === profile) return;
    runningProfileRef.current = profile;

    let cancelled = false;
    let delayTimer: number | null = null;
    setActivatings((prev) => {
      if (prev.includes(profile)) return prev;
      return [...prev, profile];
    });

    (async () => {
      let errorMessage: string | null = null;
      try {
        await patchProfiles({ current: profile });
        if (cancelled) return;

        await mutateLogs();
        await closeAllConnections();

        if (!cancelled && notifySuccess) {
          showNotice("success", t("Profile Switched"), 1000);
        }

        if (!cancelled) {
          await new Promise<void>((resolve) => {
            delayTimer = window.setTimeout(() => {
              delayTimer = null;
              resolve();
            }, 50);
          });
          await activateSelected();
        }
      } catch (error: any) {
        if (!cancelled) {
          errorMessage = error?.message || String(error);
          showNotice("error", errorMessage, 4000);
        }
      } finally {
        setActivatings((prev) => prev.filter((id) => id !== profile));
        runningProfileRef.current = null;
        if (!cancelled) {
          dispatch({ type: "RUN_FINISHED", payload: { error: errorMessage } });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (delayTimer !== null) {
        clearTimeout(delayTimer);
        delayTimer = null;
      }
    };
  }, [
    state.status,
    state.switching,
    patchProfiles,
    mutateLogs,
    closeAllConnections,
    activateSelected,
    setActivatings,
    t,
  ]);

  return {
    requestSwitch,
    switchingProfile: state.switching?.profile ?? null,
    status: state.status,
    lastError: state.lastError,
  };
};

const normalizeProfileUrl = (value?: string) => {
  if (!value) return "";
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);
    const auth =
      url.username || url.password
        ? `${url.username}${url.password ? `:${url.password}` : ""}@`
        : "";
    const normalized =
      `${url.protocol.toLowerCase()}//${auth}${url.hostname.toLowerCase()}` +
      `${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}${url.hash}`;

    return normalized.replace(/\/+$/, "");
  } catch {
    const schemeNormalized = trimmed.replace(
      /^([a-z]+):\/\//i,
      (_match, scheme: string) => `${scheme.toLowerCase()}://`,
    );
    return schemeNormalized.replace(/\/+$/, "");
  }
};

const getProfileSignature = (profile?: IProfileItem | null) => {
  if (!profile) return "";
  const { extra, selected, option, name, desc } = profile;
  return JSON.stringify({
    extra: extra ?? null,
    selected: selected ?? null,
    option: option ?? null,
    name: name ?? null,
    desc: desc ?? null,
  });
};

type ImportLandingVerifier = {
  baselineCount: number;
  hasLanding: (config?: IProfilesConfig | null) => boolean;
};

const createImportLandingVerifier = (
  items: IProfileItem[] | undefined,
  url: string,
): ImportLandingVerifier => {
  const normalizedUrl = normalizeProfileUrl(url);
  const baselineCount = items?.length ?? 0;
  const baselineProfile = normalizedUrl
    ? items?.find((item) => normalizeProfileUrl(item?.url) === normalizedUrl)
    : undefined;
  const baselineSignature = getProfileSignature(baselineProfile);
  const baselineUpdated = baselineProfile?.updated ?? 0;
  const hadBaselineProfile = Boolean(baselineProfile);

  const hasLanding = (config?: IProfilesConfig | null) => {
    const currentItems = config?.items ?? [];
    const currentCount = currentItems.length;

    if (currentCount > baselineCount) {
      console.log(
        `[导入验证] 配置数量已增加: ${baselineCount} -> ${currentCount}`,
      );
      return true;
    }

    if (!normalizedUrl) {
      return false;
    }

    const matchingProfile = currentItems.find(
      (item) => normalizeProfileUrl(item?.url) === normalizedUrl,
    );

    if (!matchingProfile) {
      return false;
    }

    if (!hadBaselineProfile) {
      console.log("[导入验证] 检测到新的订阅记录，判定为导入成功");
      return true;
    }

    const currentSignature = getProfileSignature(matchingProfile);
    const currentUpdated = matchingProfile.updated ?? 0;

    if (currentUpdated > baselineUpdated) {
      console.log(
        `[导入验证] 订阅更新时间已更新 ${baselineUpdated} -> ${currentUpdated}`,
      );
      return true;
    }

    if (currentSignature !== baselineSignature) {
      console.log("[导入验证] 订阅详情发生变化，判定为导入成功");
      return true;
    }

    return false;
  };

  return {
    baselineCount,
    hasLanding,
  };
};

const ProfilePage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { addListener } = useListen();
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activatings, setActivatings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Batch selection states
  const [batchMode, setBatchMode] = useState(false);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(
    () => new Set(),
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { current } = location.state || {};

  const {
    profiles = {},
    activateSelected,
    patchProfiles,
    mutateProfiles,
    error,
    isStale,
  } = useProfiles();

  useEffect(() => {
    const handleFileDrop = async () => {
      const unlisten = await addListener(
        TauriEvent.DRAG_DROP,
        async (event: any) => {
          const paths = event.payload.paths;

          for (const file of paths) {
            if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
              showNotice("error", t("Only YAML Files Supported"));
              continue;
            }
            const item = {
              type: "local",
              name: file.split(/\/|\\/).pop() ?? "New Profile",
              desc: "",
              url: "",
              option: {
                with_proxy: false,
                self_proxy: false,
              },
            } as IProfileItem;
            const data = await readTextFile(file);
            await createProfile(item, data);
            await mutateProfiles();
          }
        },
      );

      return unlisten;
    };

    const unsubscribe = handleFileDrop();

    return () => {
      unsubscribe.then((cleanup) => cleanup());
    };
  }, [addListener, mutateProfiles, t]);

  // 添加紧急恢复功能
  const onEmergencyRefresh = useLockFn(async () => {
    console.log("[紧急刷新] 开始强制刷新所有数据");

    try {
      // 清除所有SWR缓存
      await mutate(() => true, undefined, { revalidate: false });

      // 强制重新获取配置数据
      await mutateProfiles(undefined, {
        revalidate: true,
        rollbackOnError: false,
      });

      // 等待状态稳定后增强配置
      await new Promise((resolve) => setTimeout(resolve, 500));
      await onEnhance(false);

      showNotice("success", "数据已强制刷新", 2000);
    } catch (error: any) {
      console.error("[紧急刷新] 失败:", error);
      showNotice("error", `紧急刷新失败: ${error.message}`, 4000);
    }
  });

  const { data: chainLogs = {}, mutate: mutateLogs } = useSWR(
    "getRuntimeLogs",
    getRuntimeLogs,
  );

  const viewerRef = useRef<ProfileViewerRef>(null);
  const configRef = useRef<DialogRef>(null);

  // distinguish type
  const profileItems = useMemo(() => {
    const items = profiles.items || [];

    const type1 = ["local", "remote"];

    return items.filter((i) => i && type1.includes(i.type!));
  }, [profiles]);

  const currentActivatings = () => {
    return [...new Set([profiles.current ?? ""])].filter(Boolean);
  };

  const onImport = async () => {
    if (!url) return;
    // 校验url是否为http/https
    if (!/^https?:\/\//i.test(url)) {
      showNotice("error", t("Invalid Profile URL"));
      return;
    }
    setLoading(true);

    const importVerifier = createImportLandingVerifier(profiles?.items, url);

    const handleImportSuccess = async (noticeKey: string) => {
      showNotice("success", t(noticeKey));
      setUrl("");
      await performRobustRefresh(importVerifier);
    };

    const waitForImportLanding = async () => {
      const maxChecks = 2;
      for (let attempt = 0; attempt <= maxChecks; attempt++) {
        try {
          const currentProfiles = await getProfiles();
          if (importVerifier.hasLanding(currentProfiles)) {
            return true;
          }

          if (attempt < maxChecks) {
            await new Promise((resolve) =>
              setTimeout(resolve, 200 * (attempt + 1)),
            );
          }
        } catch (verifyErr) {
          console.warn("[导入验证] 获取配置状态失败:", verifyErr);
          break;
        }
      }

      return false;
    };

    try {
      // 尝试正常导入
      await importProfile(url);
      await handleImportSuccess("Profile Imported Successfully");
      return;
    } catch (initialErr) {
      console.warn("[订阅导入] 首次导入失败:", initialErr);

      const alreadyImported = await waitForImportLanding();
      if (alreadyImported) {
        console.warn(
          "[订阅导入] 接口返回失败，但检测到订阅已导入，跳过回退导入流程",
        );
        await handleImportSuccess("Profile Imported Successfully");
        return;
      }

      // 首次导入失败且未检测到数据变更，尝试使用自身代理
      showNotice("info", t("Import failed, retrying with Clash proxy..."));
      try {
        // 使用自身代理尝试导入
        await importProfile(url, {
          with_proxy: false,
          self_proxy: true,
        });
        await handleImportSuccess("Profile Imported with Clash proxy");
      } catch (retryErr: any) {
        // 回退导入也失败
        const retryErrmsg = retryErr?.message || retryErr.toString();
        showNotice(
          "error",
          `${t("Import failed even with Clash proxy")}: ${retryErrmsg}`,
        );
      }
    } finally {
      setDisabled(false);
      setLoading(false);
    }
  };

  const getCurrentProfileId = useCallback(
    () => profiles.current ?? undefined,
    [profiles],
  );

  const memoizedMutateLogs = useCallback(async () => {
    await mutateLogs();
  }, [mutateLogs]);

  const closeConnections = useCallback(async () => {
    await closeAllConnections();
  }, []);

  const { requestSwitch, switchingProfile: switchingProfileId } =
    useProfileSwitchController({
      getCurrentProfileId,
      patchProfiles: (payload) => patchProfiles(payload),
      mutateLogs: memoizedMutateLogs,
      closeAllConnections: closeConnections,
      activateSelected,
      setActivatings,
      t,
    });

  // 强化的刷新策略
  const performRobustRefresh = async (
    importVerifier: ImportLandingVerifier,
  ) => {
    const { baselineCount, hasLanding } = importVerifier;
    let retryCount = 0;
    const maxRetries = 5;
    const baseDelay = 200;

    while (retryCount < maxRetries) {
      try {
        console.log(`[导入刷新] 第${retryCount + 1}次尝试刷新配置数据`);

        // 强制刷新，绕过所有缓存
        await mutateProfiles(undefined, {
          revalidate: true,
          rollbackOnError: false,
        });

        // 等待状态稳定
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * (retryCount + 1)),
        );

        // 验证刷新是否成功
        const currentProfiles = await getProfiles();
        const currentCount = currentProfiles?.items?.length || 0;

        if (currentCount > baselineCount) {
          console.log(
            `[导入刷新] 配置刷新成功，配置数量 ${baselineCount} -> ${currentCount}`,
          );
          await onEnhance(false);
          return;
        }

        if (hasLanding(currentProfiles)) {
          console.log("[导入刷新] 检测到订阅内容更新，判定刷新成功");
          await onEnhance(false);
          return;
        }

        console.warn(
          `[导入刷新] 配置数量未增加 (${currentCount}), 继续重试...`,
        );
        retryCount++;
      } catch (error) {
        console.error(`[导入刷新] 第${retryCount + 1}次刷新失败:`, error);
        retryCount++;
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * retryCount),
        );
      }
    }

    // 所有重试失败后的最后尝试
    console.warn(`[导入刷新] 常规刷新失败，尝试清除缓存重新获取`);
    try {
      // 清除SWR缓存并重新获取
      await mutate("getProfiles", getProfiles(), { revalidate: true });
      await onEnhance(false);
      showNotice(
        "error",
        t("Profile imported but may need manual refresh"),
        3000,
      );
    } catch (finalError) {
      console.error(`[导入刷新] 最终刷新尝试失败:`, finalError);
      showNotice(
        "error",
        t("Profile imported successfully, please restart if not visible"),
        5000,
      );
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        await reorderProfile(active.id.toString(), over.id.toString());
        mutateProfiles();
      }
    }
  };

  const onSelect = (current: string, force: boolean) => {
    // 阻止重复点击或已激活的profile
    if (switchingProfileId === current) {
      debugProfileSwitch("DUPLICATE_CLICK_IGNORED", current);
      return;
    }

    if (!force && current === profiles.current) {
      debugProfileSwitch("ALREADY_CURRENT_IGNORED", current);
      return;
    }

    requestSwitch(current, true);
  };

  useEffect(() => {
    if (current) {
      mutateProfiles();
      requestSwitch(current, false);
    }
  }, [current, mutateProfiles, requestSwitch]);

  const onEnhance = useLockFn(async (notifySuccess: boolean) => {
    if (switchingProfileId) {
      console.log(
        `[Profile] 有profile正在切换中(${switchingProfileId})，跳过enhance操作`,
      );
      return;
    }

    const currentProfiles = currentActivatings();
    setActivatings((prev) => [...new Set([...prev, ...currentProfiles])]);

    try {
      await enhanceProfiles();
      mutateLogs();
      if (notifySuccess) {
        showNotice("success", t("Profile Reactivated"), 1000);
      }
    } catch (err: any) {
      showNotice("error", err.message || err.toString(), 3000);
    } finally {
      // 保留正在切换的profile，清除其他状态
      setActivatings((prev) =>
        switchingProfileId
          ? prev.filter((id) => id === switchingProfileId)
          : [],
      );
    }
  });

  const onDelete = useLockFn(async (uid: string) => {
    const current = profiles.current === uid;
    try {
      setActivatings([...(current ? currentActivatings() : []), uid]);
      await deleteProfile(uid);
      mutateProfiles();
      mutateLogs();
      if (current) {
        await onEnhance(false);
      }
    } catch (err: any) {
      showNotice("error", err?.message || err.toString());
    } finally {
      setActivatings([]);
    }
  });

  // 更新所有订阅
  const setLoadingCache = useSetLoadingCache();
  const onUpdateAll = useLockFn(async () => {
    const throttleMutate = throttle(mutateProfiles, 2000, {
      trailing: true,
    });
    const updateOne = async (uid: string) => {
      try {
        await updateProfile(uid);
        throttleMutate();
      } catch (err: any) {
        console.error(`更新订阅 ${uid} 失败:`, err);
      } finally {
        setLoadingCache((cache) => ({ ...cache, [uid]: false }));
      }
    };

    return new Promise((resolve) => {
      setLoadingCache((cache) => {
        // 获取没有正在更新的订阅
        const items = profileItems.filter(
          (e) => e.type === "remote" && !cache[e.uid],
        );
        const change = Object.fromEntries(items.map((e) => [e.uid, true]));

        Promise.allSettled(items.map((e) => updateOne(e.uid))).then(resolve);
        return { ...cache, ...change };
      });
    });
  });

  const onCopyLink = async () => {
    const text = await readText();
    if (text) setUrl(text);
  };

  // Batch selection functions
  const toggleBatchMode = () => {
    setBatchMode(!batchMode);
    if (!batchMode) {
      // Entering batch mode - clear previous selections
      setSelectedProfiles(new Set());
    }
  };

  const toggleProfileSelection = (uid: string) => {
    setSelectedProfiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(uid)) {
        newSet.delete(uid);
      } else {
        newSet.add(uid);
      }
      return newSet;
    });
  };

  const selectAllProfiles = () => {
    setSelectedProfiles(new Set(profileItems.map((item) => item.uid)));
  };

  const clearAllSelections = () => {
    setSelectedProfiles(new Set());
  };

  const isAllSelected = () => {
    return (
      profileItems.length > 0 && profileItems.length === selectedProfiles.size
    );
  };

  const getSelectionState = () => {
    if (selectedProfiles.size === 0) {
      return "none"; // 无选择
    } else if (selectedProfiles.size === profileItems.length) {
      return "all"; // 全选
    } else {
      return "partial"; // 部分选择
    }
  };

  const deleteSelectedProfiles = useLockFn(async () => {
    if (selectedProfiles.size === 0) return;

    try {
      // Get all currently activating profiles
      const currentActivating =
        profiles.current && selectedProfiles.has(profiles.current)
          ? [profiles.current]
          : [];

      setActivatings((prev) => [...new Set([...prev, ...currentActivating])]);

      // Delete all selected profiles
      for (const uid of selectedProfiles) {
        await deleteProfile(uid);
      }

      await mutateProfiles();
      await mutateLogs();

      // If any deleted profile was current, enhance profiles
      if (currentActivating.length > 0) {
        await onEnhance(false);
      }

      // Clear selections and exit batch mode
      setSelectedProfiles(new Set());
      setBatchMode(false);

      showNotice("success", t("Selected profiles deleted successfully"));
    } catch (err: any) {
      showNotice("error", err?.message || err.toString());
    } finally {
      setActivatings([]);
    }
  });

  const mode = useThemeMode();
  const islight = mode === "light";
  const dividercolor = islight
    ? "rgba(0, 0, 0, 0.06)"
    : "rgba(255, 255, 255, 0.06)";

  // 监听后端配置变更
  useEffect(() => {
    let unlistenPromise: Promise<() => void> | undefined;
    let lastProfileId: string | null = null;
    let lastUpdateTime = 0;
    const debounceDelay = 200;

    let refreshTimer: number | null = null;

    const setupListener = async () => {
      unlistenPromise = listen<string>("profile-changed", (event) => {
        const newProfileId = event.payload;
        const now = Date.now();

        console.log(`[Profile] 收到配置变更事件: ${newProfileId}`);

        if (
          lastProfileId === newProfileId &&
          now - lastUpdateTime < debounceDelay
        ) {
          console.log(`[Profile] 重复事件被防抖，跳过`);
          return;
        }

        lastProfileId = newProfileId;
        lastUpdateTime = now;

        console.log(`[Profile] 执行配置数据刷新`);

        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer);
        }

        // 使用异步调度避免阻塞事件处理
        refreshTimer = window.setTimeout(() => {
          mutateProfiles().catch((error) => {
            console.error("[Profile] 配置数据刷新失败:", error);
          });
          refreshTimer = null;
        }, 0);
      });
    };

    setupListener();

    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      unlistenPromise?.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [mutateProfiles]);

  return (
    <BasePage
      full
      title={t("Profiles")}
      contentStyle={{ height: "100%" }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {!batchMode ? (
            <>
              {/* Batch mode toggle button */}
              <IconButton
                size="small"
                color="inherit"
                title={t("Batch Operations")}
                onClick={toggleBatchMode}
              >
                <CheckBoxOutlineBlankRounded />
              </IconButton>

              <IconButton
                size="small"
                color="inherit"
                title={t("Update All Profiles")}
                onClick={onUpdateAll}
              >
                <RefreshRounded />
              </IconButton>

              <IconButton
                size="small"
                color="inherit"
                title={t("View Runtime Config")}
                onClick={() => configRef.current?.open()}
              >
                <TextSnippetOutlined />
              </IconButton>

              <IconButton
                size="small"
                color="primary"
                title={t("Reactivate Profiles")}
                onClick={() => onEnhance(true)}
              >
                <LocalFireDepartmentRounded />
              </IconButton>

              {/* 故障检测和紧急恢复按钮 */}
              {(error || isStale) && (
                <IconButton
                  size="small"
                  color="warning"
                  title="数据异常，点击强制刷新"
                  onClick={onEmergencyRefresh}
                  sx={{
                    animation: "pulse 2s infinite",
                    "@keyframes pulse": {
                      "0%": { opacity: 1 },
                      "50%": { opacity: 0.5 },
                      "100%": { opacity: 1 },
                    },
                  }}
                >
                  <ClearRounded />
                </IconButton>
              )}
            </>
          ) : (
            // Batch mode header
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <IconButton
                size="small"
                color="inherit"
                title={isAllSelected() ? t("Deselect All") : t("Select All")}
                onClick={
                  isAllSelected() ? clearAllSelections : selectAllProfiles
                }
              >
                {getSelectionState() === "all" ? (
                  <CheckBoxRounded />
                ) : getSelectionState() === "partial" ? (
                  <IndeterminateCheckBoxRounded />
                ) : (
                  <CheckBoxOutlineBlankRounded />
                )}
              </IconButton>
              <IconButton
                size="small"
                color="error"
                title={t("Delete Selected Profiles")}
                onClick={deleteSelectedProfiles}
                disabled={selectedProfiles.size === 0}
              >
                <DeleteRounded />
              </IconButton>
              <Button size="small" variant="outlined" onClick={toggleBatchMode}>
                {t("Done")}
              </Button>
              <Box
                sx={{ flex: 1, textAlign: "right", color: "text.secondary" }}
              >
                {t("Selected")} {selectedProfiles.size} {t("items")}
              </Box>
            </Box>
          )}
        </Box>
      }
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          pt: 1,
          mb: 0.5,
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
        }}
      >
        <BaseStyledTextField
          value={url}
          variant="outlined"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) {
              return;
            }
            if (!url || disabled || loading) {
              return;
            }
            event.preventDefault();
            void onImport();
          }}
          placeholder={t("Profile URL")}
          slotProps={{
            input: {
              sx: { pr: 1 },
              endAdornment: !url ? (
                <IconButton
                  size="small"
                  sx={{ p: 0.5 }}
                  title={t("Paste")}
                  onClick={onCopyLink}
                >
                  <ContentPasteRounded fontSize="inherit" />
                </IconButton>
              ) : (
                <IconButton
                  size="small"
                  sx={{ p: 0.5 }}
                  title={t("Clear")}
                  onClick={() => setUrl("")}
                >
                  <ClearRounded fontSize="inherit" />
                </IconButton>
              ),
            },
          }}
        />
        <LoadingButton
          disabled={!url || disabled}
          loading={loading}
          variant="contained"
          size="small"
          sx={{ borderRadius: "6px" }}
          onClick={onImport}
        >
          {t("Import")}
        </LoadingButton>
        <Button
          variant="contained"
          size="small"
          sx={{ borderRadius: "6px" }}
          onClick={() => viewerRef.current?.create()}
        >
          {t("New")}
        </Button>
      </Stack>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <Box
          sx={{
            pl: "10px",
            pr: "10px",
            height: "calc(100% - 48px)",
            overflowY: "auto",
          }}
        >
          <Box sx={{ mb: 1.5 }}>
            <Grid container spacing={{ xs: 1, lg: 1 }}>
              <SortableContext
                items={profileItems.map((x) => {
                  return x.uid;
                })}
              >
                {profileItems.map((item) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={item.file}>
                    <ProfileItem
                      id={item.uid}
                      selected={profiles.current === item.uid}
                      activating={activatings.includes(item.uid)}
                      itemData={item}
                      onSelect={(f) => onSelect(item.uid, f)}
                      onEdit={() => viewerRef.current?.edit(item)}
                      onSave={async (prev, curr) => {
                        if (prev !== curr && profiles.current === item.uid) {
                          await onEnhance(false);
                          //  await restartCore();
                          //   Notice.success(t("Clash Core Restarted"), 1000);
                        }
                      }}
                      onDelete={() => {
                        if (batchMode) {
                          toggleProfileSelection(item.uid);
                        } else {
                          onDelete(item.uid);
                        }
                      }}
                      batchMode={batchMode}
                      isSelected={selectedProfiles.has(item.uid)}
                      onSelectionChange={() => toggleProfileSelection(item.uid)}
                    />
                  </Grid>
                ))}
              </SortableContext>
            </Grid>
          </Box>
          <Divider
            variant="middle"
            flexItem
            sx={{ width: `calc(100% - 32px)`, borderColor: dividercolor }}
          ></Divider>
          <Box sx={{ mt: 1.5, mb: "10px" }}>
            <Grid container spacing={{ xs: 1, lg: 1 }}>
              <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }}>
                <ProfileMore
                  id="Merge"
                  onSave={async (prev, curr) => {
                    if (prev !== curr) {
                      await onEnhance(false);
                    }
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 6, lg: 6 }}>
                <ProfileMore
                  id="Script"
                  logInfo={chainLogs["Script"]}
                  onSave={async (prev, curr) => {
                    if (prev !== curr) {
                      await onEnhance(false);
                    }
                  }}
                />
              </Grid>
            </Grid>
          </Box>
        </Box>
        <DragOverlay />
      </DndContext>

      <ProfileViewer
        ref={viewerRef}
        onChange={async (isActivating) => {
          mutateProfiles();
          // 只有更改当前激活的配置时才触发全局重新加载
          if (isActivating) {
            await onEnhance(false);
          }
        }}
      />
      <ConfigViewer ref={configRef} />
    </BasePage>
  );
};

export default ProfilePage;
