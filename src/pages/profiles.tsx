import useSWR, { mutate } from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLockFn } from "ahooks";
import { useSetRecoilState } from "recoil";
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
import { atomLoadingCache } from "@/services/states";
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
import { useRecoilState } from "recoil";
import { atomThemeMode } from "@/services/states";
import { BaseStyledTextField } from "@/components/base/base-styled-text-field";
import { ReactSortable, SortableEvent } from "react-sortablejs";
import { ProfileItem } from "@/components/profile/profile-item";
import { listen } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/api/fs";
import { readText } from "@tauri-apps/api/clipboard";

interface ISortableItem {
  id: string;
  profileItem: IProfileItem;
}

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
  const [sortableProfileList, setSortableProfileList] = useState<
    ISortableItem[]
  >([]);
  const [sortableChainList, setSortableChainList] = useState<ISortableItem[]>(
    [],
  );
  const [reactivating, setReactivating] = useState(false);

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
    const restMap = Object.fromEntries(
      restItems.map((i) => [i.profileItem.uid, i]),
    );
    const enhanceItems = chainIds
      .map((i) => restMap[i]!)
      .filter(Boolean)
      .concat(restItems.filter((i) => !chainIds.includes(i.profileItem.uid)));
    setSortableProfileList(regularItems);
    setSortableChainList(enhanceItems);
    return { regularItems };
  }, [profiles]);

  useEffect(() => {
    const unlisten = listen("tauri://file-drop", async (event) => {
      const fileList = event.payload as string[];
      for (let file of fileList) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) {
          Notice.error("Only support YAML files.");
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

  const handleProfileDragEnd = async (event: SortableEvent) => {
    const activeId = sortableProfileList[event.oldIndex!].id;
    const overId = sortableProfileList[event.newIndex!].id;
    if (activeId !== overId) {
      await reorderProfile(activeId.toString(), overId.toString());
      mutateProfiles();
    }
  };

  // only handle unenabled chain sort
  const handleChainDragEnd = async (event: SortableEvent) => {
    const activeId = sortableChainList[event.oldIndex!].id;
    if (chain.includes(activeId)) return;
    const overId = sortableChainList[event.newIndex!].id;
    if (activeId !== overId) {
      await reorderProfile(activeId.toString(), overId.toString());
      mutateProfiles();
    }
  };

  const onImport = async () => {
    if (!url) return;
    setLoading(true);

    try {
      await importProfile(url);
      Notice.success("Successfully import profile.");
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
      Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err?.message || err.toString(), 4000);
    } finally {
      clearTimeout(reset);
      setActivating("");
    }
  });

  const setList = async (newList: ISortableItem[]) => {
    setSortableChainList(newList);
    const newChain = newList
      .filter((item) => chain.includes(item.profileItem.uid))
      .map((item) => item.profileItem.uid);
    let needUpdate = false;
    for (let index = 0; index < chain.length; index++) {
      const chainId = chain[index];
      const newChainId = newChain[index];
      if (chainId !== newChainId) {
        needUpdate = true;
        break;
      }
    }
    if (needUpdate) {
      try {
        setReactivating(true);
        await patchProfiles({ chain: newChain });
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
      Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 3000);
    }
    setReactivating(false);
  });

  const onEnable = useLockFn(async (uid: string) => {
    if (chain.includes(uid)) return;
    try {
      const newChain = [...chain, uid];
      await patchProfiles({ chain: newChain });
      mutateLogs();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onDisable = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;
    try {
      const newChain = chain.filter((i) => i !== uid);
      await patchProfiles({ chain: newChain });
      mutateLogs();
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
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
  const setLoadingCache = useSetRecoilState(atomLoadingCache);
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
          (e) => e.profileItem.type === "remote" && !cache[e.profileItem.uid],
        );
        const change = Object.fromEntries(
          items.map((e) => [e.profileItem.uid, true]),
        );

        Promise.allSettled(items.map((e) => updateOne(e.profileItem.uid))).then(
          resolve,
        );
        return { ...cache, ...change };
      });
    });
  });

  const onCopyLink = async () => {
    const text = await readText();
    if (text) setUrl(text);
  };
  const [mode] = useRecoilState(atomThemeMode);
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
          pl: "10px",
          mr: "10px",
          height: "calc(100% - 68px)",
          overflowY: "auto",
        }}>
        <ReactSortable
          style={{
            display: "flex",
            flexWrap: "wrap",
          }}
          animation={150}
          scrollSensitivity={60}
          scrollSpeed={10}
          swapThreshold={0.8}
          list={sortableProfileList}
          setList={setSortableProfileList}
          onEnd={handleProfileDragEnd}>
          {sortableProfileList.map((item) => (
            <ProfileItem
              id={item.profileItem.uid}
              selected={profiles.current === item.profileItem.uid}
              activating={
                activating === item.profileItem.uid ||
                (profiles.current === item.profileItem.uid && reactivating)
              }
              itemData={item.profileItem}
              onSelect={(f) => onSelect(item.profileItem.uid, f)}
              onEdit={() => viewerRef.current?.edit(item.profileItem)}
              onReactivate={onEnhance}
            />
          ))}
          {[...new Array(20)].map((_) => (
            <i
              style={{
                display: "flex",
                flexGrow: "1",
                margin: "0 5px",
                width: "260px",
                height: "0",
              }}></i>
          ))}
        </ReactSortable>

        {sortableChainList.length > 0 && (
          <Divider
            variant="middle"
            flexItem
            sx={{
              width: `calc(100% - 32px)`,
              borderColor: dividercolor,
            }}></Divider>
        )}

        {sortableChainList.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <ReactSortable
              style={{
                display: "flex",
                flexWrap: "wrap",
              }}
              animation={150}
              scrollSensitivity={60}
              scrollSpeed={10}
              swapThreshold={0.8}
              list={sortableChainList}
              setList={setList}
              onMove={(moveEvt, originalEvent) => {
                const { dragged, related } = moveEvt;
                if (dragged && related) {
                  const draggedType = dragged.classList.contains(
                    "enable-enhanced-item",
                  );
                  const relatedType = related.classList.contains(
                    "enable-enhanced-item",
                  );
                  if (draggedType === relatedType) {
                    return true;
                  }
                  return false;
                }
              }}
              onEnd={handleChainDragEnd}>
              {sortableChainList.map((item) => (
                <ProfileMore
                  selected={!!chain.includes(item.profileItem.uid)}
                  itemData={item.profileItem}
                  enableNum={chain.length || 0}
                  logInfo={chainLogs[item.profileItem.uid]}
                  reactivating={
                    !!chain.includes(item.profileItem.uid) && reactivating
                  }
                  onEnable={() => onEnable(item.profileItem.uid)}
                  onDisable={() => onDisable(item.profileItem.uid)}
                  onDelete={() => onDelete(item.profileItem.uid)}
                  onEdit={() => viewerRef.current?.edit(item.profileItem)}
                  onActivatedSave={onEnhance}
                />
              ))}
              {[...new Array(20)].map((_) => (
                <i
                  style={{
                    display: "flex",
                    flexGrow: "1",
                    margin: "0 5px",
                    width: "260px",
                    height: "0",
                  }}></i>
              ))}
            </ReactSortable>
          </Box>
        )}
      </Box>
      <ProfileViewer ref={viewerRef} onChange={() => mutateProfiles()} />
      <ConfigViewer ref={configRef} />
    </BasePage>
  );
};

export default ProfilePage;
