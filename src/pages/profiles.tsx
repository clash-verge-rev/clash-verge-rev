import useSWR, { mutate } from "swr";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLockFn } from "ahooks";
import { Box, Button, IconButton, Stack, Divider } from "@mui/material";
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
  getProfiles,
  importProfile,
  enhanceProfiles,
  getRuntimeLogs,
  deleteProfile,
  updateProfile,
  reorderProfile,
  createProfile,
} from "@/services/cmds";
import { useSetLoadingCache, useThemeMode } from "@/services/states";
import { closeAllConnections } from "@/services/api";
import { BasePage, DialogRef, Notice } from "@/components/base";
import {
  ProfileViewer,
  ProfileViewerRef,
} from "@/components/profile/profile-viewer";
import { ProfileMore } from "@/components/profile/profile-more";
import { useProfiles } from "@/hooks/use-profiles";
import { ConfigViewer } from "@/components/setting/mods/config-viewer";
import { throttle } from "lodash-es";
import { BaseStyledTextField } from "@/components/base/base-styled-text-field";
import { ProfileItem } from "@/components/profile/profile-item";
import { listen } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/api/fs";
import { readText } from "@tauri-apps/api/clipboard";

import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  MouseSensor,
  DragOverlay,
  DragEndEvent,
  DropAnimation,
  defaultDropAnimationSideEffects,
  UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { DraggableItem } from "@/components/base/draggable-item";

interface ISortableItem {
  id: string;
  profileItem: IProfileItem;
}

const FlexDecorationItems = memo(function FlexDecoratorItems() {
  return [...new Array(20)].map((_) => (
    <i
      style={{
        display: "flex",
        flexGrow: "1",
        margin: "0 5px",
        width: "260px",
        height: "0",
      }}></i>
  ));
});

const ProfilePage = () => {
  const { t } = useTranslation();

  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activating, setActivating] = useState("");
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
  const [reactivating, setReactivating] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
  );

  const [profileList, setProfileList] = useState<ISortableItem[]>([]);
  const [chainList, setChainList] = useState<ISortableItem[]>([]);
  const enableChains = chainList.filter((item) => chain.includes(item.id));
  const disableChains = chainList.filter((item) => !chain.includes(item.id));

  const dropAnimationConfig: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.5" } },
    }),
  };

  const [draggingProfileItem, setDraggingProfileItem] =
    useState<ISortableItem | null>(null);
  const [draggingChainItem, setDraggingChainItem] =
    useState<ISortableItem | null>(null);
  const [overItemWidth, setOverItemWidth] = useState(260);

  // distinguish type
  const { regularItems } = useMemo(() => {
    const items = profiles.items || [];
    const chainIds = profiles.chain || [];

    const type1 = ["local", "remote"];
    const type2 = ["merge", "script"];

    const regularItems = items
      .filter((i) => i && type1.includes(i.type!))
      .map((i) => {
        const item: ISortableItem = {
          id: i.uid,
          profileItem: i,
        };
        return item;
      });
    const restItems = items
      .filter((i) => i && type2.includes(i.type!))
      .map((i) => {
        const item: ISortableItem = {
          id: i.uid,
          profileItem: i,
        };
        return item;
      });
    const restMap = Object.fromEntries(restItems.map((i) => [i.id, i]));
    const enhanceItems = chainIds
      .map((i) => restMap[i]!)
      .filter(Boolean)
      .concat(restItems.filter((i) => !chainIds.includes(i.id)));
    // profiles
    setProfileList(regularItems);
    // chains
    setChainList(enhanceItems);
    return { regularItems };
  }, [profiles]);

  useEffect(() => {
    const unlisten = listen("tauri://file-drop", async (event) => {
      const fileList = event.payload as string[];
      for (let file of fileList) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
          Notice.error(t("Only YAML Files Supported"));
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
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const getDraggingIndex = (
    type: "chain" | "profile",
    id: UniqueIdentifier | undefined,
  ) => {
    if (id) {
      if (type === "profile") {
        return profileList.findIndex((item) => item.id === id);
      } else {
        return chainList.findIndex((item) => item.id === id);
      }
    } else {
      return -1;
    }
  };

  const draggingProfileIndex = getDraggingIndex(
    "profile",
    draggingProfileItem?.id,
  );
  const draggingChainIndex = getDraggingIndex("chain", draggingChainItem?.id);

  const handleProfileDragEnd = async (event: DragEndEvent) => {
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
  };

  const handleChainDragEnd = async (event: DragEndEvent) => {
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
  };

  const onImport = async () => {
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
  };

  const onSelect = useLockFn(async (current: string, force: boolean) => {
    if (!force && current === profiles.current) return;
    // 避免大多数情况下loading态闪烁
    const reset = setTimeout(() => setActivating(current), 100);
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
      setActivating("");
    }
  });

  const setActiveChainList = async (newList: ISortableItem[]) => {
    const newActiveChain = newList
      .filter((item) => chain.includes(item.id))
      .map((item) => item.id);
    let needReactive = false;
    for (let index = 0; index < chain.length; index++) {
      const chainId = chain[index];
      const newChainId = newActiveChain[index];
      if (chainId !== newChainId) {
        needReactive = true;
        break;
      }
    }
    if (needReactive && !reactivating) {
      setChainList(newList);
      try {
        setReactivating(true);
        await patchProfiles({ chain: newActiveChain });
        mutateLogs();
        Notice.success("Refresh clash config", 1000);
      } catch (err: any) {
        Notice.error(err.message || err.toString());
      } finally {
        setReactivating(false);
      }
    }
  };

  const onEnhance = useLockFn(async () => {
    try {
      setReactivating(true);
      await enhanceProfiles();
      mutateLogs();
      Notice.success(t("Profile Reactivated"), 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 3000);
    }
    setReactivating(false);
  });

  const onEnable = useLockFn(async (uid: string) => {
    if (chain.includes(uid)) return;
    try {
      setReactivating(true);
      const newChain = [...chain, uid];
      await patchProfiles({ chain: newChain });
      mutateLogs();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    } finally {
      setReactivating(false);
    }
  });

  const onDisable = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;
    try {
      setReactivating(true);
      const newChain = chain.filter((i) => i !== uid);
      await patchProfiles({ chain: newChain });
      mutateLogs();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    } finally {
      setReactivating(false);
    }
  });

  const onDelete = useLockFn(async (uid: string) => {
    try {
      await onDisable(uid);
      await deleteProfile(uid);
      mutateProfiles();
      mutateLogs();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
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
      } finally {
        setLoadingCache((cache) => ({ ...cache, [uid]: false }));
      }
    };

    return new Promise((resolve) => {
      setLoadingCache((cache) => {
        // 获取没有正在更新的订阅
        const items = regularItems.filter(
          (e) => e.profileItem.type === "remote" && !cache[e.id],
        );
        const change = Object.fromEntries(items.map((e) => [e.id, true]));

        Promise.allSettled(items.map((e) => updateOne(e.id))).then(resolve);
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
            onClick={onUpdateAll}>
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
            loading={reactivating}
            loadingPosition="end"
            variant="contained"
            color="primary"
            endIcon={<LocalFireDepartmentRounded />}
            title={t("Reactivate Profiles")}
            onClick={onEnhance}>
            <span>{t("Reactivate Profiles")}</span>
          </LoadingButton>

          {/* <IconButton
            size="small"
            color="primary"
            title={t("Reactivate Profiles")}
            onClick={onEnhance}>
            <LocalFireDepartmentRounded />
          </IconButton> */}
        </Box>
      }>
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
        }}>
        <BaseStyledTextField
          value={url}
          variant="outlined"
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("Profile URL")}
          InputProps={{
            sx: { pr: 1 },
            endAdornment: !url ? (
              <IconButton
                size="small"
                sx={{ p: 0.5 }}
                title={t("Paste")}
                onClick={onCopyLink}>
                <ContentPasteRounded fontSize="inherit" />
              </IconButton>
            ) : (
              <IconButton
                size="small"
                sx={{ p: 0.5 }}
                title={t("Clear")}
                onClick={() => setUrl("")}>
                <ClearRounded fontSize="inherit" />
              </IconButton>
            ),
          }}
        />
        <LoadingButton
          disabled={!url || disabled}
          loading={loading}
          variant="contained"
          size="small"
          sx={{ borderRadius: "6px" }}
          onClick={onImport}>
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
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          px: "10px",
          height: "calc(100% - 68px)",
          overflowY: "auto",
        }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          // onDragStart={(event) => {}}
          onDragOver={(event) => {
            const { over } = event;
            if (over) {
              const itemWidth = event.over?.rect.width;
              if (itemWidth && itemWidth !== overItemWidth) {
                setOverItemWidth(itemWidth);
              }
              const item = profileList.find((i) => i.id === event.active.id)!;
              setDraggingProfileItem(item);
            }
          }}
          onDragEnd={handleProfileDragEnd}
          onDragCancel={() => setDraggingProfileItem(null)}>
          <Box sx={{ width: "100%" }}>
            <SortableContext items={profileList.map((item) => item.id)}>
              <Box sx={{ display: "flex", flexWrap: "wrap", mr: "5px" }}>
                {profileList.map((item) => (
                  <DraggableItem
                    key={item.id}
                    id={item.id}
                    sx={{
                      display: "flex",
                      flexGrow: 1,
                      width: "260px",
                      margin: "5px",
                    }}>
                    <ProfileItem
                      sx={{
                        "& > .MuiBox-root": {
                          bgcolor:
                            draggingProfileItem?.id === item.id
                              ? "var(--background-color-alpha)"
                              : "",
                        },
                      }}
                      selected={
                        (activating === "" && profiles.current === item.id) ||
                        activating === item.id
                      }
                      isDragging={draggingProfileItem ? true : false}
                      activating={
                        activating === item.id ||
                        (profiles.current === item.id && reactivating)
                      }
                      itemData={item.profileItem}
                      onSelect={(f) => onSelect(item.id, f)}
                      onEdit={() => viewerRef.current?.edit(item.profileItem)}
                      onReactivate={onEnhance}
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
                  (activating === "" &&
                    profiles.current === draggingProfileItem.id) ||
                  activating === draggingProfileItem.id
                }
                activating={
                  activating === draggingProfileItem.id ||
                  (profiles.current === draggingProfileItem.id && reactivating)
                }
                itemData={draggingProfileItem.profileItem}
                onSelect={(f) => onSelect(draggingProfileItem.id, f)}
                onEdit={() =>
                  viewerRef.current?.edit(draggingProfileItem.profileItem)
                }
                onReactivate={onEnhance}
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
                width: `calc(100% - 32px)`,
                my: 1,
                borderColor: dividercolor,
              }}>
              {t("Enhance Scripts")}
            </Divider>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              // onDragStart={(event) => {}}
              onDragOver={(event) => {
                const { over } = event;
                if (over) {
                  const itemWidth = event.over?.rect.width;
                  if (itemWidth && itemWidth !== overItemWidth) {
                    setOverItemWidth(itemWidth);
                  }
                  const item = chainList.find(
                    (item) => item.id === event.active.id,
                  )!;
                  setDraggingChainItem(item);
                }
              }}
              onDragEnd={handleChainDragEnd}
              onDragCancel={() => setDraggingChainItem(null)}>
              <Box sx={{ display: "flex", flexWrap: "wrap", mr: "5px" }}>
                <SortableContext
                  items={enableChains.map((item) => item.id)}
                  strategy={rectSortingStrategy}>
                  {enableChains.map((item) => (
                    <DraggableItem
                      key={item.id}
                      id={item.id}
                      data={{
                        activated: !!chain.includes(item.id),
                      }}
                      sx={{
                        display: "flex",
                        flexGrow: 1,
                        width: "260px",
                        margin: "5px",
                      }}>
                      <ProfileMore
                        sx={{
                          "& > .MuiBox-root": {
                            bgcolor:
                              draggingChainItem?.id === item.id
                                ? "var(--background-color-alpha)"
                                : "",
                          },
                        }}
                        selected={!!chain.includes(item.id)}
                        isDragging={draggingChainItem ? true : false}
                        itemData={item.profileItem}
                        enableNum={chain.length || 0}
                        logInfo={chainLogs[item.id]}
                        reactivating={
                          !!chain.includes(item.id) &&
                          (reactivating || activating !== "")
                        }
                        onEnable={() => onEnable(item.id)}
                        onDisable={() => onDisable(item.id)}
                        onDelete={() => onDelete(item.id)}
                        onEdit={() => viewerRef.current?.edit(item.profileItem)}
                        onActivatedSave={onEnhance}
                      />
                    </DraggableItem>
                  ))}
                </SortableContext>
                <SortableContext
                  items={disableChains.map((item) => item.id)}
                  strategy={rectSortingStrategy}>
                  {disableChains.map((item) => (
                    <DraggableItem
                      key={item.id}
                      id={item.id}
                      data={{
                        activated: !!chain.includes(item.id),
                      }}
                      sx={{
                        display: "flex",
                        flexGrow: 1,
                        width: "260px",
                        margin: "5px",
                      }}>
                      <ProfileMore
                        sx={{
                          "& > .MuiBox-root": {
                            bgcolor:
                              draggingChainItem?.id === item.id
                                ? "var(--background-color-alpha)"
                                : "",
                          },
                        }}
                        selected={!!chain.includes(item.id)}
                        isDragging={draggingChainItem ? true : false}
                        itemData={item.profileItem}
                        enableNum={chain.length || 0}
                        logInfo={chainLogs[item.id]}
                        reactivating={
                          !!chain.includes(item.id) &&
                          (reactivating || activating !== "")
                        }
                        onEnable={() => onEnable(item.id)}
                        onDisable={() => onDisable(item.id)}
                        onDelete={() => onDelete(item.id)}
                        onEdit={() => viewerRef.current?.edit(item.profileItem)}
                        onActivatedSave={onEnhance}
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
                      selected={!!chain.includes(draggingChainItem.id)}
                      itemData={draggingChainItem.profileItem}
                      sx={{
                        width: overItemWidth,
                        borderRadius: "8px",
                        boxShadow: "0px 0px 10px 5px rgba(0,0,0,0.2)",
                      }}
                      enableNum={chain.length || 0}
                      logInfo={chainLogs[draggingChainItem.id]}
                      reactivating={
                        !!chain.includes(draggingChainItem.id) &&
                        (reactivating || activating !== "")
                      }
                      onEnable={() => onEnable(draggingChainItem.id)}
                      onDisable={() => onDisable(draggingChainItem.id)}
                      onDelete={() => onDelete(draggingChainItem.id)}
                      onEdit={() =>
                        viewerRef.current?.edit(draggingChainItem.profileItem)
                      }
                      onActivatedSave={onEnhance}
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
