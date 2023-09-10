import useSWR, { mutate } from "swr";
import { useMemo, useRef, useState } from "react";
import { useLockFn } from "ahooks";
import { useSetRecoilState } from "recoil";
import { Box, Button, Grid, IconButton, Stack, TextField } from "@mui/material";
import {
  ClearRounded,
  ContentCopyRounded,
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
} from "@/services/cmds";
import { atomLoadingCache } from "@/services/states";
import { closeAllConnections } from "@/services/api";
import { BasePage, DialogRef, Notice } from "@/components/base";
import {
  ProfileViewer,
  ProfileViewerRef,
} from "@/components/profile/profile-viewer";
import { ProfileItem } from "@/components/profile/profile-item";
import { ProfileMore } from "@/components/profile/profile-more";
import { useProfiles } from "@/hooks/use-profiles";
import { ConfigViewer } from "@/components/setting/mods/config-viewer";
import { throttle } from "lodash-es";

const ProfilePage = () => {
  const { t } = useTranslation();

  const [url, setUrl] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [activating, setActivating] = useState("");

  const {
    profiles = {},
    activateSelected,
    patchProfiles,
    mutateProfiles,
  } = useProfiles();

  const { data: chainLogs = {}, mutate: mutateLogs } = useSWR(
    "getRuntimeLogs",
    getRuntimeLogs
  );

  const chain = profiles.chain || [];
  const viewerRef = useRef<ProfileViewerRef>(null);
  const configRef = useRef<DialogRef>(null);

  // distinguish type
  const { regularItems, enhanceItems } = useMemo(() => {
    const items = profiles.items || [];
    const chain = profiles.chain || [];

    const type1 = ["local", "remote"];
    const type2 = ["merge", "script"];

    const regularItems = items.filter((i) => i && type1.includes(i.type!));
    const restItems = items.filter((i) => i && type2.includes(i.type!));
    const restMap = Object.fromEntries(restItems.map((i) => [i.uid, i]));
    const enhanceItems = chain
      .map((i) => restMap[i]!)
      .filter(Boolean)
      .concat(restItems.filter((i) => !chain.includes(i.uid)));

    return { regularItems, enhanceItems };
  }, [profiles]);

  const onImport = async () => {
    if (!url) return;
    setUrl("");
    setDisabled(true);

    try {
      await importProfile(url);
      Notice.success("Successfully import profile.");

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
    } finally {
      setDisabled(false);
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

  const onEnhance = useLockFn(async () => {
    try {
      await enhanceProfiles();
      mutateLogs();
      Notice.success("Refresh clash config", 1000);
    } catch (err: any) {
      Notice.error(err.message || err.toString(), 3000);
    }
  });

  const onEnable = useLockFn(async (uid: string) => {
    if (chain.includes(uid)) return;
    const newChain = [...chain, uid];
    await patchProfiles({ chain: newChain });
    mutateLogs();
  });

  const onDisable = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;
    const newChain = chain.filter((i) => i !== uid);
    await patchProfiles({ chain: newChain });
    mutateLogs();
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

  const onMoveTop = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;
    const newChain = [uid].concat(chain.filter((i) => i !== uid));
    await patchProfiles({ chain: newChain });
    mutateLogs();
  });

  const onMoveEnd = useLockFn(async (uid: string) => {
    if (!chain.includes(uid)) return;
    const newChain = chain.filter((i) => i !== uid).concat([uid]);
    await patchProfiles({ chain: newChain });
    mutateLogs();
  });

  // 更新所有配置
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
        // 获取没有正在更新的配置
        const items = regularItems.filter(
          (e) => e.type === "remote" && !cache[e.uid]
        );
        const change = Object.fromEntries(items.map((e) => [e.uid, true]));

        Promise.allSettled(items.map((e) => updateOne(e.uid))).then(resolve);
        return { ...cache, ...change };
      });
    });
  });

  const onCopyLink = async () => {
    const text = await navigator.clipboard.readText();
    if (text) setUrl(text);
  };

  return (
    <BasePage
      title={t("Profiles")}
      header={
        <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1 }}>
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
            onClick={onEnhance}
          >
            <LocalFireDepartmentRounded />
          </IconButton>
        </Box>
      }
    >
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <TextField
          hiddenLabel
          fullWidth
          size="small"
          value={url}
          variant="outlined"
          autoComplete="off"
          spellCheck="false"
          onChange={(e) => setUrl(e.target.value)}
          sx={{ input: { py: 0.65, px: 1.25 } }}
          placeholder={t("Profile URL")}
          InputProps={{
            sx: { pr: 1 },
            endAdornment: !url ? (
              <IconButton
                size="small"
                sx={{ p: 0.5 }}
                title={t("Paste")}
                onClick={onCopyLink}
              >
                <ContentCopyRounded fontSize="inherit" />
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
          }}
        />
        <Button
          disabled={!url || disabled}
          variant="contained"
          size="small"
          onClick={onImport}
        >
          {t("Import")}
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={() => viewerRef.current?.create()}
        >
          {t("New")}
        </Button>
      </Stack>

      <Box sx={{ mb: 4.5 }}>
        <Grid container spacing={{ xs: 2, lg: 3 }}>
          {regularItems.map((item) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={item.file}>
              <ProfileItem
                selected={profiles.current === item.uid}
                activating={activating === item.uid}
                itemData={item}
                onSelect={(f) => onSelect(item.uid, f)}
                onEdit={() => viewerRef.current?.edit(item)}
              />
            </Grid>
          ))}
        </Grid>
      </Box>

      {enhanceItems.length > 0 && (
        <Grid container spacing={{ xs: 2, lg: 3 }}>
          {enhanceItems.map((item) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={item.file}>
              <ProfileMore
                selected={!!chain.includes(item.uid)}
                itemData={item}
                enableNum={chain.length || 0}
                logInfo={chainLogs[item.uid]}
                onEnable={() => onEnable(item.uid)}
                onDisable={() => onDisable(item.uid)}
                onDelete={() => onDelete(item.uid)}
                onMoveTop={() => onMoveTop(item.uid)}
                onMoveEnd={() => onMoveEnd(item.uid)}
                onEdit={() => viewerRef.current?.edit(item)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <ProfileViewer ref={viewerRef} onChange={() => mutateProfiles()} />
      <ConfigViewer ref={configRef} />
    </BasePage>
  );
};

export default ProfilePage;
