import useSWR, { mutate } from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, IconButton, Stack, Divider, Grid } from "@mui/material";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { LoadingButton } from "@mui/lab";
import {
  ClearRounded,
  ContentPasteRounded,
  LocalFireDepartmentRounded,
  RefreshRounded,
  TextSnippetOutlined,
} from "@mui/icons-material";
import { useTranslation } from "react-i18next";
import {
  importProfile,
  enhanceProfiles,
  //restartCore,
  getRuntimeLogs,
  deleteProfile,
  updateProfile,
  reorderProfile,
  createProfile,
  getProfiles,
} from "@/services/cmds";
import { useSetLoadingCache, useThemeMode } from "@/services/states";
import { closeAllConnections } from "@/services/cmds";
import { BasePage, DialogRef } from "@/components/base";
import {
  ProfileViewer,
  ProfileViewerRef,
} from "@/components/profile/profile-viewer";
import { ProfileMore } from "@/components/profile/profile-more";
import { ProfileItem } from "@/components/profile/profile-item";
import { useProfiles } from "@/hooks/use-profiles";
import { ConfigViewer } from "@/components/setting/mods/config-viewer";
import { throttle } from "lodash-es";
import { BaseStyledTextField } from "@/components/base/base-styled-text-field";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useLocation } from "react-router-dom";
import { useListen } from "@/hooks/use-listen";
import { listen } from "@tauri-apps/api/event";
import { TauriEvent } from "@tauri-apps/api/event";
import { showNotice } from "@/services/noticeService";

// 记录profile切换状态
const debugProfileSwitch = (action: string, profile: string, extra?: any) => {
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(
    `[Profile-Debug][${timestamp}] ${action}: ${profile}`,
    extra || "",
  );
};

// 检查请求是否已过期
const isRequestOutdated = (
  currentSequence: number,
  requestSequenceRef: any,
  profile: string,
) => {
  if (currentSequence !== requestSequenceRef.current) {
    debugProfileSwitch(
      "REQUEST_OUTDATED",
      profile,
      `当前序列号: ${currentSequence}, 最新序列号: ${requestSequenceRef.current}`,
    );
    return true;
  }
  return false;
};

// 检查是否被中断
const isOperationAborted = (
  abortController: AbortController,
  profile: string,
) => {
  if (abortController.signal.aborted) {
    debugProfileSwitch("OPERATION_ABORTED", profile);
    return true;
  }
  return false;
};

const ProfilePage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { addListener } = useListen();
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activatings, setActivatings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 防止重复切换
  const switchingProfileRef = useRef<string | null>(null);

  // 支持中断当前切换操作
  const abortControllerRef = useRef<AbortController | null>(null);

  // 只处理最新的切换请求
  const requestSequenceRef = useRef<number>(0);

  // 待处理请求跟踪，取消排队的请求
  const pendingRequestRef = useRef<Promise<any> | null>(null);

  // 处理profile切换中断
  const handleProfileInterrupt = (
    previousSwitching: string,
    newProfile: string,
  ) => {
    debugProfileSwitch(
      "INTERRUPT_PREVIOUS",
      previousSwitching,
      `被 ${newProfile} 中断`,
    );

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      debugProfileSwitch("ABORT_CONTROLLER_TRIGGERED", previousSwitching);
    }

    if (pendingRequestRef.current) {
      debugProfileSwitch("CANCEL_PENDING_REQUEST", previousSwitching);
    }

    setActivatings((prev) => prev.filter((id) => id !== previousSwitching));
    showNotice(
      "info",
      `${t("Profile switch interrupted by new selection")}: ${previousSwitching} → ${newProfile}`,
      3000,
    );
  };

  // 清理切换状态
  const cleanupSwitchState = (profile: string, sequence: number) => {
    setActivatings((prev) => prev.filter((id) => id !== profile));
    switchingProfileRef.current = null;
    abortControllerRef.current = null;
    pendingRequestRef.current = null;
    debugProfileSwitch("SWITCH_END", profile, `序列号: ${sequence}`);
  };
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { current } = location.state || {};

  useEffect(() => {
    const handleFileDrop = async () => {
      const unlisten = await addListener(
        TauriEvent.DRAG_DROP,
        async (event: any) => {
          const paths = event.payload.paths;

          for (let file of paths) {
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
            let data = await readTextFile(file);
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
  }, []);

  const {
    profiles = {},
    activateSelected,
    patchProfiles,
    mutateProfiles,
    isLoading,
    error,
    isStale,
  } = useProfiles();

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

    // 保存导入前的配置状态用于故障恢复
    const preImportProfilesCount = profiles?.items?.length || 0;

    try {
      // 尝试正常导入
      await importProfile(url);
      showNotice("success", t("Profile Imported Successfully"));
      setUrl("");

      // 增强的刷新策略
      await performRobustRefresh(preImportProfilesCount);
    } catch (err: any) {
      // 首次导入失败，尝试使用自身代理
      const errmsg = err.message || err.toString();
      showNotice("info", t("Import failed, retrying with Clash proxy..."));
      try {
        // 使用自身代理尝试导入
        await importProfile(url, {
          with_proxy: false,
          self_proxy: true,
        });
        // 回退导入成功
        showNotice("success", t("Profile Imported with Clash proxy"));
        setUrl("");

        // 增强的刷新策略
        await performRobustRefresh(preImportProfilesCount);
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

  // 强化的刷新策略
  const performRobustRefresh = async (expectedMinCount: number) => {
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

        if (currentCount > expectedMinCount) {
          console.log(
            `[导入刷新] 配置刷新成功，配置数量: ${expectedMinCount} -> ${currentCount}`,
          );
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

  const executeBackgroundTasks = async (
    profile: string,
    sequence: number,
    abortController: AbortController,
  ) => {
    try {
      if (
        sequence === requestSequenceRef.current &&
        switchingProfileRef.current === profile &&
        !abortController.signal.aborted
      ) {
        await activateSelected();
        console.log(`[Profile] 后台处理完成，序列号: ${sequence}`);
      } else {
        debugProfileSwitch(
          "BACKGROUND_TASK_SKIPPED",
          profile,
          `序列号过期或被中断: ${sequence} vs ${requestSequenceRef.current}`,
        );
      }
    } catch (err: any) {
      console.warn("Failed to activate selected proxies:", err);
    }
  };

  const activateProfile = async (profile: string, notifySuccess: boolean) => {
    if (profiles.current === profile && !notifySuccess) {
      console.log(`[Profile] 目标profile ${profile} 已经是当前配置，跳过切换`);
      return;
    }

    const currentSequence = ++requestSequenceRef.current;
    debugProfileSwitch("NEW_REQUEST", profile, `序列号: ${currentSequence}`);

    // 处理中断逻辑
    const previousSwitching = switchingProfileRef.current;
    if (previousSwitching && previousSwitching !== profile) {
      handleProfileInterrupt(previousSwitching, profile);
    }

    // 防止重复切换同一个profile
    if (switchingProfileRef.current === profile) {
      debugProfileSwitch("DUPLICATE_SWITCH_BLOCKED", profile);
      return;
    }

    // 初始化切换状态
    switchingProfileRef.current = profile;
    debugProfileSwitch("SWITCH_START", profile, `序列号: ${currentSequence}`);

    const currentAbortController = new AbortController();
    abortControllerRef.current = currentAbortController;

    setActivatings((prev) => {
      if (prev.includes(profile)) return prev;
      return [...prev, profile];
    });

    try {
      console.log(
        `[Profile] 开始切换到: ${profile}，序列号: ${currentSequence}`,
      );

      // 检查请求有效性
      if (
        isRequestOutdated(currentSequence, requestSequenceRef, profile) ||
        isOperationAborted(currentAbortController, profile)
      ) {
        return;
      }

      // 执行切换请求
      const requestPromise = patchProfiles(
        { current: profile },
        currentAbortController.signal,
      );
      pendingRequestRef.current = requestPromise;

      const success = await requestPromise;

      if (pendingRequestRef.current === requestPromise) {
        pendingRequestRef.current = null;
      }

      // 再次检查有效性
      if (
        isRequestOutdated(currentSequence, requestSequenceRef, profile) ||
        isOperationAborted(currentAbortController, profile)
      ) {
        return;
      }

      // 完成切换
      await mutateLogs();
      closeAllConnections();

      if (notifySuccess && success) {
        showNotice("success", t("Profile Switched"), 1000);
      }

      console.log(
        `[Profile] 切换到 ${profile} 完成，序列号: ${currentSequence}，开始后台处理`,
      );

      // 延迟执行后台任务
      setTimeout(
        () =>
          executeBackgroundTasks(
            profile,
            currentSequence,
            currentAbortController,
          ),
        50,
      );
    } catch (err: any) {
      if (pendingRequestRef.current) {
        pendingRequestRef.current = null;
      }

      // 检查是否因为中断或过期而出错
      if (
        isOperationAborted(currentAbortController, profile) ||
        isRequestOutdated(currentSequence, requestSequenceRef, profile)
      ) {
        return;
      }

      console.error(`[Profile] 切换失败:`, err);
      showNotice("error", err?.message || err.toString(), 4000);
    } finally {
      // 只有当前profile仍然是正在切换的profile且序列号匹配时才清理状态
      if (
        switchingProfileRef.current === profile &&
        currentSequence === requestSequenceRef.current
      ) {
        cleanupSwitchState(profile, currentSequence);
      } else {
        debugProfileSwitch(
          "CLEANUP_SKIPPED",
          profile,
          `序列号不匹配或已被接管: ${currentSequence} vs ${requestSequenceRef.current}`,
        );
      }
    }
  };
  const onSelect = async (current: string, force: boolean) => {
    // 阻止重复点击或已激活的profile
    if (switchingProfileRef.current === current) {
      debugProfileSwitch("DUPLICATE_CLICK_IGNORED", current);
      return;
    }

    if (!force && current === profiles.current) {
      debugProfileSwitch("ALREADY_CURRENT_IGNORED", current);
      return;
    }

    await activateProfile(current, true);
  };

  useEffect(() => {
    (async () => {
      if (current) {
        mutateProfiles();
        await activateProfile(current, false);
      }
    })();
  }, current);

  const onEnhance = useLockFn(async (notifySuccess: boolean) => {
    if (switchingProfileRef.current) {
      console.log(
        `[Profile] 有profile正在切换中(${switchingProfileRef.current})，跳过enhance操作`,
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
        prev.filter((id) => id === switchingProfileRef.current),
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
      current && (await onEnhance(false));
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

  const mode = useThemeMode();
  const islight = mode === "light" ? true : false;
  const dividercolor = islight
    ? "rgba(0, 0, 0, 0.06)"
    : "rgba(255, 255, 255, 0.06)";

  // 监听后端配置变更
  useEffect(() => {
    let unlistenPromise: Promise<() => void> | undefined;
    let lastProfileId: string | null = null;
    let lastUpdateTime = 0;
    const debounceDelay = 200;

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

        // 使用异步调度避免阻塞事件处理
        setTimeout(() => {
          mutateProfiles().catch((error) => {
            console.error("[Profile] 配置数据刷新失败:", error);
          });
        }, 0);
      });
    };

    setupListener();

    return () => {
      unlistenPromise?.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [mutateProfiles]);

  // 组件卸载时清理中断控制器
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        debugProfileSwitch("COMPONENT_UNMOUNT_CLEANUP", "all");
      }
    };
  }, []);

  return (
    <BasePage
      full
      title={t("Profiles")}
      contentStyle={{ height: "100%" }}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
                      onDelete={() => onDelete(item.uid)}
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
