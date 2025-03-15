import {
  BasePage,
  BaseStyledTextField,
  DialogRef,
  DraggableItem,
  Notice,
} from "@/components/base";
import { ProfileItem } from "@/components/profile/profile-item";
import { ProfileMore } from "@/components/profile/profile-more";
import {
  ProfileViewer,
  ProfileViewerRef,
} from "@/components/profile/profile-viewer";
import { ConfigViewer } from "@/components/setting/mods/config-viewer";
import { useProfiles } from "@/hooks/use-profiles";
import {
  createProfile,
  deleteProfile,
  enhanceProfiles,
  getProfiles,
  getRuntimeLogs,
  importProfile,
  patchProfile,
  reorderProfile,
  updateProfile,
} from "@/services/cmds";
import { useSetLoadingCache } from "@/services/states";
import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DropAnimation,
  MouseSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable";
import {
  ClearRounded,
  ContentPasteRounded,
  LocalFireDepartmentRounded,
  RefreshRounded,
  TextSnippetOutlined,
} from "@mui/icons-material";
import { LoadingButton } from "@mui/lab";
import { Box, Button, Divider, IconButton, Stack } from "@mui/material";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useLockFn, useMemoizedFn } from "ahooks";
import { isEqual, throttle } from "lodash-es";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import useSWR, { mutate } from "swr";

const FlexDecorationItems = memo(function FlexDecoratorItems() {
  return [...Array(20)].map((_, index) => (
    <i key={index} className="mx-[5px] my-0 flex h-0 w-[260px] grow"></i>
  ));
});

const ProfilePage = () => {
  const { t } = useTranslation();

  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activatingUids, setActivatingUids] = useState<string[]>([]);
  const [importLoading, setImportLoading] = useState(false);
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

  const chain = profiles.chain || [];
  const viewerRef = useRef<ProfileViewerRef>(null);
  const configRef = useRef<DialogRef>(null);

  // distinguish type
  const { profileItems, globalChains, enabledChainUids } = useMemo(() => {
    const items = profiles.items || [];
    const type_p = ["local", "remote"];
    const type_c = ["merge", "script"];
    const profileItems = items.filter((i) => i && type_p.includes(i.type!));
    const globalChains = items.filter(
      (i) => i && type_c.includes(i.type!) && i.scope === "global",
    );
    const enabledChainUids = globalChains
      .filter((i) => i.enable)
      .map((i) => i.uid);
    return { profileItems, globalChains, enabledChainUids };
  }, [profiles]);

  // sortable
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  );
  const [profileList, setProfileList] = useState<IProfileItem[]>([]);
  const [chainList, setChainList] = useState<IProfileItem[]>([]);
  const dropAnimationConfig: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };
  const [draggingItem, setDraggingItem] = useState<IProfileItem | null>(null);
  const [overItemWidth, setOverItemWidth] = useState(260);

  useEffect(() => {
    const dragUnlisten = listen(TauriEvent.DRAG_DROP, async (event) => {
      const payload = event.payload as FileDragDropPayload;
      const fileList = payload.paths;
      for (let file of fileList) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
          Notice.error(t("Only YAML Files Supported"));
          continue;
        }
        const filename =
          file.split(/\/|\\/).pop()?.replace(RegExp(".yaml|.yml"), "") ??
          "New Profile";
        const item = {
          type: "local",
          name: filename,
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
    });

    return () => {
      dragUnlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    setProfileList(profileItems);
    setChainList(globalChains);
  }, [profileItems, globalChains]);

  const handleProfileDragEnd = useMemoizedFn(async (event: DragEndEvent) => {
    setDraggingItem(null);
    const { active, over } = event;
    if (over) {
      const activeId = active.id.toString();
      const overId = over.id.toString();
      if (activeId !== overId) {
        const activeIndex = profileList.findIndex(
          (item) => item.uid === activeId,
        );
        const overIndex = profileList.findIndex((item) => item.uid === overId);
        setProfileList((items) => arrayMove(items, activeIndex, overIndex));
        await reorderProfile(activeId, overId);
        mutateProfiles();
      }
    }
  });

  const handleChainDragEnd = useMemoizedFn(async (event: DragEndEvent) => {
    setDraggingItem(null);
    const { active, over } = event;
    if (over) {
      const activeId = active.id.toString();
      const overId = over.id.toString();
      if (activeId !== overId) {
        const activeIndex = chainList.findIndex(
          (item) => item.uid === activeId,
        );
        const overIndex = chainList.findIndex((item) => item.uid === overId);
        const newChainList = arrayMove(chainList, activeIndex, overIndex);
        const newEnabledChainUids = newChainList
          .filter((i) => i.enable)
          .map((item) => item.uid);
        const needToEnhance = !isEqual(enabledChainUids, newEnabledChainUids);
        setChainList(newChainList);
        await reorderProfile(activeId, overId);
        if (needToEnhance) {
          await onEnhance();
        }
        mutateProfiles();
      }
    }
  });

  const onImport = useMemoizedFn(async () => {
    if (!url) return;
    setImportLoading(true);

    try {
      await importProfile(url);
      Notice.success(t("Profile Imported Successfully"));
      setUrl("");
      setImportLoading(false);

      getProfiles().then((newProfiles) => {
        mutate("getProfiles", newProfiles);

        const remoteItem = newProfiles.items?.find((e) => e.type === "remote");
        if (!newProfiles.current && remoteItem) {
          const current = remoteItem.uid;
          patchProfiles({ current });
          mutateLogs();
          setTimeout(() => activateSelected(), 2000);
        }
      });
    } catch (err: any) {
      Notice.error(err.message || err.toString());
      setImportLoading(false);
    } finally {
      setDisabled(false);
      setImportLoading(false);
    }
  });

  const onSelect = useMemoizedFn(
    useLockFn(async (current: string, force: boolean) => {
      if (current === profiles.current || activatingUids.length > 0) return;
      try {
        setActivatingUids([current, ...enabledChainUids]);
        await patchProfiles({ current });
        mutateLogs();
        // closeAllConnections();
        setTimeout(() => activateSelected(), 2000);
        Notice.success(t("Profile Switched"), 1000);
      } catch (err: any) {
        Notice.error(err?.message || err.toString(), 4000);
      } finally {
        setTimeout(() => {
          setActivatingUids([]);
        }, 500);
      }
    }),
  );

  const onDelete = useMemoizedFn(
    useLockFn(async (uid: string) => {
      try {
        setActivatingUids([uid, ...enabledChainUids]);
        await deleteProfile(uid);
        mutateProfiles();
      } catch (err: any) {
        Notice.error(err?.message || err.toString());
      } finally {
        setActivatingUids([]);
      }
    }),
  );

  const handleToggleEnable = useMemoizedFn(
    useLockFn(async (chainUid: string, enable: boolean) => {
      try {
        setActivatingUids([
          profiles.current || "",
          chainUid,
          ...enabledChainUids,
        ]);
        await patchProfile(chainUid, { enable: enable });
        mutateLogs();
        mutateProfiles();
        Notice.success(t("Profile Reactivated"), 1000);
      } catch (error) {
        console.error(error);
      } finally {
        setTimeout(() => {
          setActivatingUids([]);
        }, 500);
      }
    }),
  );

  const handleChainDelete = useMemoizedFn(
    useLockFn(async (item: IProfileItem) => {
      try {
        if (item.enable) {
          setActivatingUids([
            profiles.current || "",
            item.uid,
            ...enabledChainUids,
          ]);
        }
        await deleteProfile(item.uid);
        mutateProfiles();
        if (item.enable) {
          await onEnhance();
        }
      } catch (error: any) {
        Notice.error(error);
      } finally {
        if (item.enable) {
          setActivatingUids([]);
        }
      }
    }),
  );

  const onEnhance = useMemoizedFn(
    useLockFn(async () => {
      try {
        setActivatingUids([profiles.current || "", ...enabledChainUids]);
        await enhanceProfiles();
        mutateLogs();
        Notice.success(t("Profile Reactivated"), 1000);
      } catch (err: any) {
        Notice.error(err.message || err.toString(), 3000);
      } finally {
        setActivatingUids([]);
      }
    }),
  );

  // 更新所有订阅
  const setLoadingCache = useSetLoadingCache();
  const onUpdateAll = useMemoizedFn(
    useLockFn(async () => {
      const throttleMutate = throttle(mutateProfiles, 2000, {
        trailing: true,
      });
      const updateOne = async (uid: string) => {
        try {
          await updateProfile(uid);
          throttleMutate();
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
    }),
  );

  const onCopyLink = useMemoizedFn(async () => {
    const text = await readText();
    if (text) setUrl(text);
  });

  return (
    <BasePage
      full
      title={t("Profiles")}
      header={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <IconButton
            size="small"
            color="inherit"
            title={t("Update All Profiles")}
            onClick={() => onUpdateAll()}>
            <RefreshRounded />
          </IconButton>

          <IconButton
            size="small"
            color="inherit"
            title={t("View Runtime Config")}
            onClick={() => configRef.current?.open()}>
            <TextSnippetOutlined />
          </IconButton>

          <LoadingButton
            size="small"
            // loading={activating.profile !== "" || activating.chain !== ""}
            loading={activatingUids.length > 0}
            loadingPosition="end"
            variant="contained"
            color="primary"
            endIcon={<LocalFireDepartmentRounded />}
            title={t("Reactivate Profiles")}
            onClick={() => onEnhance()}>
            <span>{t("Reactivate Profiles")}</span>
          </LoadingButton>
        </Box>
      }>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          mb: "10px",
          pt: "10px",
          mx: "10px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          boxSizing: "border-box",
        }}>
        <BaseStyledTextField
          value={url}
          variant="outlined"
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("Profile URL")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.length > 0) {
              onImport();
            }
          }}
          slotProps={{
            input: {
              sx: { pr: 1 },
              endAdornment: !url ? (
                <IconButton
                  size="small"
                  color="primary"
                  sx={{ p: 0.5 }}
                  title={t("Paste")}
                  onClick={() => onCopyLink()}>
                  <ContentPasteRounded fontSize="inherit" />
                </IconButton>
              ) : (
                <IconButton
                  size="small"
                  color="primary"
                  sx={{ p: 0.5 }}
                  title={t("Clear")}
                  onClick={() => setUrl("")}>
                  <ClearRounded fontSize="inherit" />
                </IconButton>
              ),
            },
          }}
        />
        <LoadingButton
          disabled={!url || disabled}
          loading={importLoading}
          variant="contained"
          size="small"
          sx={{ borderRadius: "6px" }}
          onClick={() => onImport()}>
          {t("Import")}
        </LoadingButton>
        <Button
          variant="contained"
          size="small"
          sx={{ borderRadius: "6px" }}
          onClick={() => viewerRef.current?.create(null)}>
          {t("New")}
        </Button>
      </Stack>
      <Box sx={{ px: "10px" }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={(event) => {
            const { over } = event;
            if (over) {
              const itemWidth = event.over?.rect.width;
              if (itemWidth && itemWidth !== overItemWidth) {
                setOverItemWidth(itemWidth);
              }
              const item = profileList.find((i) => i.uid === event.active.id)!;
              setDraggingItem(item);
            }
          }}
          onDragEnd={(e) => handleProfileDragEnd(e)}
          onDragCancel={() => setDraggingItem(null)}>
          <Box>
            <SortableContext items={profileList.map((item) => item.uid)}>
              <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                {profileList.map((item) => (
                  <DraggableItem
                    key={item.uid}
                    id={item.uid}
                    sx={{
                      display: "flex",
                      flexGrow: 1,
                      width: "260px",
                      margin: "5px",
                    }}>
                    <ProfileItem
                      selected={
                        activatingUids.includes(item.uid) ||
                        (activatingUids.length === 0 &&
                          profiles.current === item.uid)
                      }
                      isDragging={draggingItem?.uid === item.uid}
                      activating={activatingUids.includes(item.uid)}
                      itemData={item}
                      chainLogs={chainLogs}
                      onSelect={(f) => onSelect(item.uid, f)}
                      onDelete={() => onDelete(item.uid)}
                      // onEdit={() => viewerRef.current?.edit(item)}
                      onReactivate={() => onEnhance()}
                    />
                  </DraggableItem>
                ))}
                <FlexDecorationItems />
              </Box>
            </SortableContext>
          </Box>
          <DragOverlay dropAnimation={dropAnimationConfig}>
            {draggingItem ? (
              <ProfileItem
                sx={{
                  width: overItemWidth,
                  borderRadius: "8px",
                  boxShadow: "0px 0px 10px 5px rgba(0,0,0,0.2)",
                }}
                selected={
                  activatingUids.includes(draggingItem.uid) ||
                  (activatingUids.length === 0 &&
                    profiles.current === draggingItem.uid)
                }
                activating={activatingUids.includes(draggingItem.uid)}
                itemData={draggingItem}
                chainLogs={chainLogs}
                onSelect={(f) => onSelect(draggingItem.uid, f)}
                onDelete={() => onDelete(draggingItem.uid)}
                // onEdit={() => viewerRef.current?.edit(draggingProfileItem)}
                onReactivate={() => onEnhance()}
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {chainList.length > 0 && (
          <>
            <Divider
              variant="middle"
              flexItem
              sx={(theme) => ({
                width: "calc(100% - 32px)",
                my: 1,
                borderColor: "rgba(0, 0, 0, 0.06)",
                ...theme.applyStyles("dark", {
                  borderColor: "rgba(255, 255, 255, 0.06)",
                }),
              })}>
              {t("Enhance Scripts")}
            </Divider>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragOver={(event) => {
                const { over } = event;
                if (over) {
                  const itemWidth = event.over?.rect.width;
                  if (itemWidth && itemWidth !== overItemWidth) {
                    setOverItemWidth(itemWidth);
                  }
                  const item = chainList.find(
                    (item) => item.uid === event.active.id,
                  )!;
                  setDraggingItem(item);
                }
              }}
              onDragEnd={(e) => handleChainDragEnd(e)}
              onDragCancel={() => setDraggingItem(null)}>
              <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                <SortableContext
                  items={chainList.map((item) => item.uid)}
                  strategy={rectSortingStrategy}>
                  {chainList.map((item) => (
                    <DraggableItem
                      key={item.uid}
                      id={item.uid}
                      data={{ activated: !!chain.includes(item.uid) }}
                      sx={{
                        display: "flex",
                        flexGrow: 1,
                        width: "260px",
                        margin: "5px",
                      }}>
                      <ProfileMore
                        selected={
                          activatingUids.includes(item.uid) || !!item.enable
                        }
                        isDragging={draggingItem?.uid === item.uid}
                        itemData={item}
                        chainLogs={chainLogs}
                        reactivating={activatingUids.includes(item.uid)}
                        onToggleEnable={async (enable) => {
                          handleToggleEnable(item.uid, enable);
                        }}
                        onDelete={() => handleChainDelete(item)}
                        onActivatedSave={() => onEnhance()}
                      />
                    </DraggableItem>
                  ))}
                </SortableContext>
                <FlexDecorationItems />
              </Box>
              {createPortal(
                <DragOverlay dropAnimation={dropAnimationConfig}>
                  {draggingItem ? (
                    <ProfileMore
                      selected={
                        activatingUids.includes(draggingItem.uid) ||
                        !!draggingItem.enable
                      }
                      itemData={draggingItem}
                      sx={{
                        width: overItemWidth,
                        borderRadius: "8px",
                        boxShadow: "0px 0px 10px 5px rgba(0,0,0,0.2)",
                      }}
                      chainLogs={chainLogs}
                      reactivating={activatingUids.includes(draggingItem.uid)}
                      onToggleEnable={async (enable) => {
                        handleToggleEnable(draggingItem.uid, enable);
                      }}
                      onActivatedSave={() => onEnhance()}
                    />
                  ) : null}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          </>
        )}
      </Box>
      <ProfileViewer ref={viewerRef} onChange={() => mutateProfiles()} />
      <ConfigViewer ref={configRef} />
    </BasePage>
  );
};

export default ProfilePage;
