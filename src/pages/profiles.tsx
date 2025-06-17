import useSWR from "swr";
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
} from "@/services/cmds";
import { useSetLoadingCache, useThemeMode } from "@/services/states";
import { closeAllConnections } from "@/services/api";
import { BasePage, DialogRef } from "@/components/base";
import {
  ProfileViewer,
  ProfileViewerRef,
} from "@/components/profile/profile-viewer";
import { ProfileMore } from "@/components/profile/profile-more";
import { ProfileItem } from "@/components/profile/profile-item";
import { useProfiles } from "@/hooks/use-profiles";
import { ConfigViewer } from "@/components/setting/mods/config-viewer";
import { add, throttle } from "lodash-es";
import { BaseStyledTextField } from "@/components/base/base-styled-text-field";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useLocation } from "react-router-dom";
import { useListen } from "@/hooks/use-listen";
import { listen } from "@tauri-apps/api/event";
import { TauriEvent } from "@tauri-apps/api/event";
import { showNotice } from "@/services/noticeService";

const ProfilePage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { addListener } = useListen();
  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activatings, setActivatings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
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
  } = useProfiles();

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
    setLoading(true);

    try {
      // 尝试正常导入
      await importProfile(url);
      showNotice("success", t("Profile Imported Successfully"));
      setUrl("");
      mutateProfiles();
      await onEnhance(false);
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
        mutateProfiles();
        await onEnhance(false);
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

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over) {
      if (active.id !== over.id) {
        await reorderProfile(active.id.toString(), over.id.toString());
        mutateProfiles();
      }
    }
  };

  const activateProfile = useLockFn(
    async (profile: string, notifySuccess: boolean) => {
      if (profiles.current === profile && !notifySuccess) {
        console.log(
          `[Profile] 目标profile ${profile} 已经是当前配置，跳过切换`,
        );
        return;
      }

      // 避免大多数情况下loading态闪烁
      const reset = setTimeout(() => {
        setActivatings((prev) => [...prev, profile]);
      }, 100);

      try {
        console.log(`[Profile] 开始切换到: ${profile}`);

        const success = await patchProfiles({ current: profile });
        await mutateLogs();
        closeAllConnections();

        if (notifySuccess && success) {
          showNotice("success", t("Profile Switched"), 1000);
        }

        // 立即清除loading状态
        clearTimeout(reset);
        setActivatings([]);

        console.log(`[Profile] 切换到 ${profile} 完成，开始后台处理`);

        setTimeout(async () => {
          try {
            await activateSelected();
            console.log(`[Profile] 后台处理完成`);
          } catch (err: any) {
            console.warn("Failed to activate selected proxies:", err);
          }
        }, 50);
      } catch (err: any) {
        console.error(`[Profile] 切换失败:`, err);
        showNotice("error", err?.message || err.toString(), 4000);
        clearTimeout(reset);
        setActivatings([]);
      }
    },
  );
  const onSelect = useLockFn(async (current: string, force: boolean) => {
    if (!force && current === profiles.current) return;
    await activateProfile(current, true);
  });

  useEffect(() => {
    (async () => {
      if (current) {
        mutateProfiles();
        await activateProfile(current, false);
      }
    })();
  }, current);

  const onEnhance = useLockFn(async (notifySuccess: boolean) => {
    setActivatings(currentActivatings());
    try {
      await enhanceProfiles();
      mutateLogs();
      if (notifySuccess) {
        showNotice("success", t("Profile Reactivated"), 1000);
      }
    } catch (err: any) {
      showNotice("error", err.message || err.toString(), 3000);
    } finally {
      setActivatings([]);
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
