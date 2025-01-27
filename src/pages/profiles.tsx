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
import { closeAllConnections } from "@/services/api";
import {
  createProfile,
  deleteProfile,
  enhanceProfiles,
  getProfiles,
  getRuntimeLogs,
  importProfile,
  reorderProfile,
  updateProfile,
} from "@/services/cmds";
import { useSetLoadingCache, useThemeMode } from "@/services/states";
import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DropAnimation,
  MouseSensor,
  UniqueIdentifier,
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
import { useLocalStorage } from "foxact/use-local-storage";
import { throttle } from "lodash-es";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import useSWR, { mutate } from "swr";

interface ActivatingProfile {
  profile: string;
  chain: string;
}

const FlexDecorationItems = memo(function FlexDecoratorItems() {
  return [...Array(20)].map((_, index) => (
    <i key={index} className="mx-[5px] my-0 flex h-0 w-[260px] flex-grow"></i>
  ));
});

type FileDragDropPayload = {
  paths: string[];
};

const ProfilePage = () => {
  const { t } = useTranslation();

  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activating, setActivating] = useLocalStorage<ActivatingProfile>(
    "activatingProfile",
    { profile: "", chain: "" },
    {
      serializer: JSON.stringify,
      deserializer: JSON.parse,
    },
  );
  const [loading, setLoading] = useState(false);
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
  const { regularItems, enhanceItems } = useMemo(() => {
    const items = profiles.items || [];
    const chainIds = profiles.chain || [];

    const type1 = ["local", "remote"];
    const type2 = ["merge", "script"];

    const regularItems = items.filter((i) => i && type1.includes(i.type!));
    const restItems = items.filter((i) => i && type2.includes(i.type!));
    const restMap = Object.fromEntries(restItems.map((i) => [i.uid, i]));
    const enhanceItems = chainIds
      .map((i) => restMap[i]!)
      .filter(Boolean)
      .concat(restItems.filter((i) => !chainIds.includes(i.uid)));
    return { regularItems, enhanceItems };
  }, [profiles]);

  // sortable
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  );
  const [profileList, setProfileList] = useState<IProfileItem[]>([]);
  const [chainList, setChainList] = useState<IProfileItem[]>([]);
  const enableChains = chainList.filter((item) => chain.includes(item.uid));
  const disableChains = chainList.filter((item) => !chain.includes(item.uid));
  const dropAnimationConfig: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };
  const [draggingProfileItem, setDraggingProfileItem] =
    useState<IProfileItem | null>(null);
  const [draggingChainItem, setDraggingChainItem] =
    useState<IProfileItem | null>(null);
  const [overItemWidth, setOverItemWidth] = useState(260);

  useEffect(() => {
    setProfileList(regularItems);
    setChainList(enhanceItems);
  }, [regularItems, enhanceItems]);

  useEffect(() => {
    const unlisten = listen(TauriEvent.DRAG_DROP, async (event) => {
      console.log("drag drop event: ", event);
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
      unlisten.then((fn) => fn());
    };
  }, []);

  const getDraggingIndex = useMemoizedFn(
    (type: "chain" | "profile", id: UniqueIdentifier | undefined) => {
      if (id) {
        if (type === "profile") {
          return profileList.findIndex((item) => item.uid === id);
        } else {
          return chainList.findIndex((item) => item.uid === id);
        }
      } else {
        return -1;
      }
    },
  );

  const draggingProfileIndex = getDraggingIndex(
    "profile",
    draggingProfileItem?.uid,
  );
  const draggingChainIndex = getDraggingIndex("chain", draggingChainItem?.uid);

  const handleProfileDragEnd = useMemoizedFn(async (event: DragEndEvent) => {
    setDraggingProfileItem(null);
    const { active, over } = event;
    if (over) {
      const overIndex = getDraggingIndex("profile", over.id);
      if (draggingProfileIndex !== overIndex) {
        const activeId = active.id.toString();
        const overId = over.id.toString();
        setProfileList((items) =>
          arrayMove(items, draggingProfileIndex, overIndex),
        );
        await reorderProfile(activeId, overId);
        mutateProfiles();
      }
    }
  });

  const handleChainDragEnd = useMemoizedFn(async (event: DragEndEvent) => {
    setDraggingChainItem(null);
    const { active, over } = event;
    if (over) {
      // check their status type
      const activeItemSelected = active.data.current?.activated;
      const overItemSelected = over.data.current?.activated;
      if (activeItemSelected !== overItemSelected) {
        // no same type
        return;
      }
      // same type, it can drag and sort
      const overIndex = getDraggingIndex("chain", over.id);
      if (draggingChainIndex !== overIndex) {
        const newChainList = arrayMove(
          chainList,
          draggingChainIndex,
          overIndex,
        );
        if (activeItemSelected && overItemSelected) {
          setActiveChainList(newChainList);
        } else {
          const activeId = active.id.toString();
          const overId = over.id.toString();
          setChainList(newChainList);
          await reorderProfile(activeId, overId);
          mutateProfiles();
        }
      }
    }
  });

  const onImport = useMemoizedFn(async () => {
    if (!url) return;
    setLoading(true);

    try {
      await importProfile(url);
      Notice.success(t("Profile Imported Successfully"));
      setUrl("");
      setLoading(false);

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
      setLoading(false);
    } finally {
      setDisabled(false);
      setLoading(false);
    }
  });

  const onSelect = useMemoizedFn(
    useLockFn(async (current: string, force: boolean) => {
      if (!force && current === profiles.current) return;
      // 避免大多数情况下 loading 态闪烁
      const reset = setTimeout(
        () =>
          setActivating((o) => ({ profile: current, chain: o?.chain ?? "" })),
        100,
      );
      try {
        await patchProfiles({ current });
        mutateLogs();
        closeAllConnections();
        setTimeout(() => activateSelected(), 2000);
        Notice.success(t("Profile Switched"), 1000);
      } catch (err: any) {
        Notice.error(err?.message || err.toString(), 4000);
      } finally {
        clearTimeout(reset);
        setTimeout(() => {
          setActivating((o) => ({ profile: "", chain: o?.chain ?? "" }));
        }, 500);
      }
    }),
  );

  const setActiveChainList = useMemoizedFn(async (newList: IProfileItem[]) => {
    const newActiveChain = newList
      .filter((item) => chain.includes(item.uid))
      .map((item) => item.uid);
    let needReactive = false;
    for (let index = 0; index < chain.length; index++) {
      const chainId = chain[index];
      const newChainId = newActiveChain[index];
      if (chainId !== newChainId) {
        needReactive = true;
        break;
      }
    }
    if (needReactive && activating.profile === "" && activating.chain === "") {
      try {
        setChainList(newList);
        setActivating((o) => ({
          profile: o?.profile ?? "",
          chain: newActiveChain[0],
        }));
        await patchProfiles({ chain: newActiveChain });
        mutateLogs();
        Notice.success("Refresh clash config", 1000);
      } catch (err: any) {
        Notice.error(err.message || err.toString());
      } finally {
        setActivating((o) => ({ profile: o?.profile ?? "", chain: "" }));
      }
    }
  });

  const onEnhance = useMemoizedFn(
    useLockFn(async () => {
      try {
        setActivating((o) => ({
          profile: profiles.current!,
          chain: o?.chain ?? "",
        }));
        await enhanceProfiles();
        mutateLogs();
        Notice.success(t("Profile Reactivated"), 1000);
      } catch (err: any) {
        Notice.error(err.message || err.toString(), 3000);
      } finally {
        setActivating((o) => ({ profile: "", chain: o?.chain ?? "" }));
      }
    }),
  );

  const onEnable = useMemoizedFn(
    useLockFn(async (uid: string) => {
      if (chain.includes(uid)) return;
      try {
        setActivating((o) => ({ profile: o?.profile ?? "", chain: uid }));
        const newChain = [...chain, uid];
        await patchProfiles({ chain: newChain });
        mutateLogs();
      } catch (err: any) {
        Notice.error(err?.message || err.toString());
      } finally {
        setActivating((o) => ({ profile: o?.profile ?? "", chain: "" }));
      }
    }),
  );

  const onDisable = useMemoizedFn(
    useLockFn(async (uid: string) => {
      if (!chain.includes(uid)) return;
      try {
        setActivating((o) => ({ profile: o?.profile ?? "", chain: uid }));
        const newChain = chain.filter((i) => i !== uid);
        await patchProfiles({ chain: newChain });
        mutateLogs();
      } catch (err: any) {
        Notice.error(err?.message || err.toString());
      } finally {
        setActivating((o) => ({ profile: o?.profile ?? "", chain: "" }));
      }
    }),
  );

  const onDelete = useMemoizedFn(
    useLockFn(async (uid: string) => {
      try {
        await onDisable(uid);
        await deleteProfile(uid);
        mutateProfiles();
        mutateLogs();
      } catch (err: any) {
        Notice.error(err?.message || err.toString());
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
          const items = regularItems.filter(
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
  const mode = useThemeMode();
  const islight = mode === "light" ? true : false;
  const dividercolor = islight
    ? "rgba(0, 0, 0, 0.06)"
    : "rgba(255, 255, 255, 0.06)";

  return (
    <BasePage
      full
      title={t("Profiles")}
      // contentStyle={{ height: "100%" }}
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
            loading={activating.profile !== "" || activating.chain !== ""}
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
          loading={loading}
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
          onClick={() => viewerRef.current?.create()}>
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
              setDraggingProfileItem(item);
            }
          }}
          onDragEnd={(e) => handleProfileDragEnd(e)}
          onDragCancel={() => setDraggingProfileItem(null)}>
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
                        (activating.profile === "" &&
                          profiles.current === item.uid) ||
                        activating.profile === item.uid
                      }
                      isDragging={draggingProfileItem?.uid === item.uid}
                      activating={
                        activating.profile === item.uid ||
                        (profiles.current === item.uid &&
                          activating.chain !== "")
                      }
                      itemData={item}
                      onSelect={(f) => onSelect(item.uid, f)}
                      onEdit={() => viewerRef.current?.edit(item)}
                      onReactivate={() => onEnhance()}
                    />
                  </DraggableItem>
                ))}
                <FlexDecorationItems />
              </Box>
            </SortableContext>
          </Box>
          <DragOverlay dropAnimation={dropAnimationConfig}>
            {draggingProfileItem ? (
              <ProfileItem
                sx={{
                  width: overItemWidth,
                  borderRadius: "8px",
                  boxShadow: "0px 0px 10px 5px rgba(0,0,0,0.2)",
                }}
                selected={
                  (activating.profile === "" &&
                    profiles.current === draggingProfileItem.uid) ||
                  activating.profile === draggingProfileItem.uid
                }
                activating={
                  activating.profile === draggingProfileItem.uid ||
                  (profiles.current === draggingProfileItem.uid &&
                    activating.chain !== "")
                }
                itemData={draggingProfileItem}
                onSelect={(f) => onSelect(draggingProfileItem.uid, f)}
                onEdit={() => viewerRef.current?.edit(draggingProfileItem)}
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
              sx={{
                width: "calc(100% - 32px)",
                my: 1,
                borderColor: dividercolor,
              }}>
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
                  setDraggingChainItem(item);
                }
              }}
              onDragEnd={(e) => handleChainDragEnd(e)}
              onDragCancel={() => setDraggingChainItem(null)}>
              <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                <SortableContext
                  items={enableChains.map((item) => item.uid)}
                  strategy={rectSortingStrategy}>
                  {enableChains.map((item) => (
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
                          !!chain.includes(item.uid) ||
                          activating.chain === item.uid
                        }
                        isDragging={draggingChainItem?.uid === item.uid}
                        itemData={item}
                        enableNum={chain.length || 0}
                        logInfo={chainLogs[item.uid]}
                        reactivating={
                          (!!chain.includes(item.uid) &&
                            (activating.chain !== "" ||
                              activating.profile !== "")) ||
                          activating.chain === item.uid
                        }
                        onEnable={() => onEnable(item.uid)}
                        onDisable={() => onDisable(item.uid)}
                        onDelete={() => onDelete(item.uid)}
                        onEdit={() => viewerRef.current?.edit(item)}
                        onActivatedSave={() => onEnhance()}
                      />
                    </DraggableItem>
                  ))}
                </SortableContext>
                <SortableContext
                  items={disableChains.map((item) => item.uid)}
                  strategy={rectSortingStrategy}>
                  {disableChains.map((item) => (
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
                        selected={!!chain.includes(item.uid)}
                        isDragging={draggingChainItem?.uid === item.uid}
                        itemData={item}
                        enableNum={chain.length || 0}
                        logInfo={chainLogs[item.uid]}
                        reactivating={
                          (!!chain.includes(item.uid) &&
                            (activating.chain !== "" ||
                              activating.profile !== "")) ||
                          activating.chain === item.uid
                        }
                        onEnable={() => onEnable(item.uid)}
                        onDisable={() => onDisable(item.uid)}
                        onDelete={() => onDelete(item.uid)}
                        onEdit={() => viewerRef.current?.edit(item)}
                        onActivatedSave={() => onEnhance()}
                      />
                    </DraggableItem>
                  ))}
                </SortableContext>
                <FlexDecorationItems />
              </Box>
              {createPortal(
                <DragOverlay dropAnimation={dropAnimationConfig}>
                  {draggingChainItem ? (
                    <ProfileMore
                      selected={!!chain.includes(draggingChainItem.uid)}
                      itemData={draggingChainItem}
                      sx={{
                        width: overItemWidth,
                        borderRadius: "8px",
                        boxShadow: "0px 0px 10px 5px rgba(0,0,0,0.2)",
                      }}
                      enableNum={chain.length || 0}
                      logInfo={chainLogs[draggingChainItem.uid]}
                      reactivating={
                        (!!chain.includes(draggingChainItem.uid) &&
                          (activating.chain !== "" ||
                            activating.profile !== "")) ||
                        activating.chain === draggingChainItem.uid
                      }
                      onEnable={() => onEnable(draggingChainItem.uid)}
                      onDisable={() => onDisable(draggingChainItem.uid)}
                      onDelete={() => onDelete(draggingChainItem.uid)}
                      onEdit={() => viewerRef.current?.edit(draggingChainItem)}
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
