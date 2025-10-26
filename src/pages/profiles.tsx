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
import { throttle } from "lodash-es";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import useSWR, { mutate } from "swr";

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
  switchProfileCommand,
} from "@/services/cmds";
import { showNotice } from "@/services/noticeService";
import { useSetLoadingCache, useThemeMode } from "@/services/states";

// Record profile switch state
const debugProfileSwitch = (action: string, profile: string, extra?: any) => {
  const timestamp = new Date().toISOString().substring(11, 23);
  console.log(
    `[Profile-Debug][${timestamp}] ${action}: ${profile}`,
    extra || "",
  );
};

type ProfileSwitchFinishedPayload = {
  profileId: string;
  success: boolean;
  notify: boolean;
  taskId: number;
};

type RustPanicPayload = {
  message: string;
  location: string;
};

type SwitchRequest = {
  profileId: string;
  notifySuccess: boolean;
};

type SwitchQueueEntry = SwitchRequest & { token: number };

type SwitchQueueState = {
  active: SwitchQueueEntry | null;
  queue: SwitchQueueEntry[];
  seq: number;
  lastError: string | null;
};

type SwitchQueueAction =
  | { type: "enqueue"; request: SwitchRequest }
  | { type: "complete"; profileId: string }
  | { type: "failure"; profileId: string; error: string }
  | { type: "reset-error" };

const initialSwitchQueueState: SwitchQueueState = {
  active: null,
  queue: [],
  seq: 0,
  lastError: null,
};

const promoteNext = (
  queue: SwitchQueueEntry[],
): { next: SwitchQueueEntry | null; rest: SwitchQueueEntry[] } => {
  if (queue.length === 0) {
    return { next: null, rest: [] };
  }
  const [next, ...rest] = queue;
  return { next, rest };
};

const switchQueueReducer = (
  state: SwitchQueueState,
  action: SwitchQueueAction,
): SwitchQueueState => {
  switch (action.type) {
    case "enqueue": {
      const { request } = action;
      if (state.active?.profileId === request.profileId) {
        if (!state.active.notifySuccess && request.notifySuccess) {
          return {
            ...state,
            active: { ...state.active, notifySuccess: true },
          };
        }
        return state;
      }

      const filteredQueue = state.queue.filter(
        (entry) => entry.profileId !== request.profileId,
      );
      const nextEntry: SwitchQueueEntry = {
        ...request,
        token: state.seq + 1,
      };

      if (!state.active) {
        return {
          active: nextEntry,
          queue: filteredQueue,
          seq: state.seq + 1,
          lastError: null,
        };
      }

      return {
        ...state,
        queue: [...filteredQueue, nextEntry],
        seq: state.seq + 1,
        lastError: null,
      };
    }
    case "complete": {
      if (state.active?.profileId === action.profileId) {
        if (state.queue.length === 0) {
          return {
            ...state,
            active: null,
            lastError: null,
          };
        }
        const [next, ...rest] = state.queue;
        return {
          ...state,
          active: next,
          queue: rest,
          lastError: null,
        };
      }

      return {
        ...state,
        queue: state.queue.filter(
          (entry) => entry.profileId !== action.profileId,
        ),
      };
    }
    case "failure": {
      const remainingQueue = state.queue.filter(
        (entry) => entry.profileId !== action.profileId,
      );

      if (state.active?.profileId === action.profileId) {
        const { next, rest } = promoteNext(remainingQueue);
        return {
          ...state,
          active: next,
          queue: rest,
          lastError: action.error,
        };
      }

      return {
        ...state,
        queue: remainingQueue,
        lastError: action.error,
      };
    }
    case "reset-error": {
      if (!state.lastError) {
        return state;
      }
      return {
        ...state,
        lastError: null,
      };
    }
    default:
      return state;
  }
};

const getSwitchingProfileIds = (state: SwitchQueueState) => {
  const ids = new Set<string>();
  if (state.active) {
    ids.add(state.active.profileId);
  }
  state.queue.forEach((entry) => ids.add(entry.profileId));
  return Array.from(ids);
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
        `[Import Verify] Configuration count increased: ${baselineCount} -> ${currentCount}`,
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
      console.log(
        "[Import Verify] Detected new profile record; treating as success",
      );
      return true;
    }

    const currentSignature = getProfileSignature(matchingProfile);
    const currentUpdated = matchingProfile.updated ?? 0;

    if (currentUpdated > baselineUpdated) {
      console.log(
        `[Import Verify] Profile timestamp updated ${baselineUpdated} -> ${currentUpdated}`,
      );
      return true;
    }

    if (currentSignature !== baselineSignature) {
      console.log(
        "[Import Verify] Profile details changed; treating as success",
      );
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
  const [manualActivatings, setManualActivatings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchState, dispatchSwitch] = useReducer(
    switchQueueReducer,
    initialSwitchQueueState,
  );
  const switchingProfileId = switchState.active?.profileId ?? null;
  const switchCommandTokenRef = useRef<number | null>(null);
  const switchActivatingIds = useMemo(
    () => getSwitchingProfileIds(switchState),
    [switchState],
  );
  const activatings = useMemo(() => {
    const merged = new Set<string>(manualActivatings);
    switchActivatingIds.forEach((id) => merged.add(id));
    return Array.from(merged);
  }, [manualActivatings, switchActivatingIds]);

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
    mutateProfiles,
    error,
    isStale,
  } = useProfiles();
  const activateSelectedRef = useRef(activateSelected);
  const mutateProfilesRef = useRef(mutateProfiles);
  const mutateLogsRef = useRef<(() => Promise<any> | void) | null>(null);
  const tRef = useRef(t);

  useEffect(() => {
    activateSelectedRef.current = activateSelected;
  }, [activateSelected]);

  useEffect(() => {
    mutateProfilesRef.current = mutateProfiles;
  }, [mutateProfiles]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

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

  // Add emergency recovery capability
  const onEmergencyRefresh = useLockFn(async () => {
    console.log("[Emergency Refresh] Starting forced refresh of all data");

    try {
      // Clear all SWR caches
      await mutate(() => true, undefined, { revalidate: false });

      // Force fetching profile data
      await mutateProfiles(undefined, {
        revalidate: true,
        rollbackOnError: false,
      });

      // Wait for state to stabilize before enhancing the profile
      await new Promise((resolve) => setTimeout(resolve, 500));
      await onEnhance(false);

      showNotice("success", "Data forcibly refreshed", 2000);
    } catch (error: any) {
      console.error("[Emergency Refresh] Failed:", error);
      showNotice("error", `Emergency refresh failed: ${error.message}`, 4000);
    }
  });

  const { data: chainLogs = {}, mutate: mutateLogs } = useSWR(
    "getRuntimeLogs",
    getRuntimeLogs,
  );
  useEffect(() => {
    mutateLogsRef.current = mutateLogs;
  }, [mutateLogs]);

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
    // Validate that the URL uses http/https
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
          console.warn(
            "[Import Verify] Failed to fetch profile state:",
            verifyErr,
          );
          break;
        }
      }

      return false;
    };

    try {
      // Attempt standard import
      await importProfile(url);
      await handleImportSuccess("Profile Imported Successfully");
      return;
    } catch (initialErr) {
      console.warn("[Profile Import] Initial import failed:", initialErr);

      const alreadyImported = await waitForImportLanding();
      if (alreadyImported) {
        console.warn(
          "[Profile Import] API reported failure, but profile already imported; skipping rollback",
        );
        await handleImportSuccess("Profile Imported Successfully");
        return;
      }

      // Initial import failed without data change; try built-in proxy
      showNotice("info", t("Import failed, retrying with Clash proxy..."));
      try {
        // Attempt import using built-in proxy
        await importProfile(url, {
          with_proxy: false,
          self_proxy: true,
        });
        await handleImportSuccess("Profile Imported with Clash proxy");
      } catch (retryErr: any) {
        // Rollback import also failed
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

  const currentProfileId = profiles.current ?? null;

  // Enhanced refresh strategy
  const performRobustRefresh = async (
    importVerifier: ImportLandingVerifier,
  ) => {
    const { baselineCount, hasLanding } = importVerifier;
    let retryCount = 0;
    const maxRetries = 5;
    const baseDelay = 200;

    while (retryCount < maxRetries) {
      try {
        console.log(
          `[Import Refresh] Attempt ${retryCount + 1} to refresh profile data`,
        );

        // Force refresh and bypass caches
        await mutateProfiles(undefined, {
          revalidate: true,
          rollbackOnError: false,
        });

        // Wait for state to stabilize
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * (retryCount + 1)),
        );

        // Verify whether refresh succeeded
        const currentProfiles = await getProfiles();
        const currentCount = currentProfiles?.items?.length || 0;

        if (currentCount > baselineCount) {
          console.log(
            `[Import Refresh] Profile refresh succeeded; count ${baselineCount} -> ${currentCount}`,
          );
          await onEnhance(false);
          return;
        }

        if (hasLanding(currentProfiles)) {
          console.log(
            "[Import Refresh] Detected profile update; treating as success",
          );
          await onEnhance(false);
          return;
        }

        console.warn(
          `[Import Refresh] Profile count unchanged (${currentCount}), retrying...`,
        );
        retryCount++;
      } catch (error) {
        console.error(
          `[Import Refresh] Attempt ${retryCount + 1} failed:`,
          error,
        );
        retryCount++;
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelay * retryCount),
        );
      }
    }

    // Final attempt after all retries fail
    console.warn(
      `[Import Refresh] Regular refresh failed; clearing cache and retrying`,
    );
    try {
      // Clear SWR cache and refetch
      await mutate("getProfiles", getProfiles(), { revalidate: true });
      await onEnhance(false);
      showNotice(
        "error",
        t("Profile imported but may need manual refresh"),
        3000,
      );
    } catch (finalError) {
      console.error(
        `[Import Refresh] Final refresh attempt failed:`,
        finalError,
      );
      showNotice(
        "error",
        t("Profile imported successfully, please restart if not visible"),
        5000,
      );
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      await reorderProfile(active.id.toString(), over.id.toString());
      mutateProfiles();
    }
  };

  const enqueueSwitch = useCallback(
    (targetProfile: string, notifySuccess: boolean) => {
      dispatchSwitch({
        type: "enqueue",
        request: { profileId: targetProfile, notifySuccess },
      });
    },
    [dispatchSwitch],
  );

  useEffect(() => {
    let mounted = true;
    const unlistenPromise = listen<ProfileSwitchFinishedPayload>(
      "profile-switch-finished",
      async (event) => {
        if (!mounted) return;
        const payload = event.payload;
        if (!payload) return;

        const { profileId, success, notify, taskId } = payload;
        debugProfileSwitch("SWITCH_FINISHED", profileId, {
          success,
          taskId,
          notify,
        });
        setManualActivatings((prev) => prev.filter((id) => id !== profileId));

        if (success) {
          dispatchSwitch({ type: "complete", profileId });
          switchCommandTokenRef.current = null;
          await mutateLogsRef.current?.();
          await activateSelectedRef.current?.();
          if (notify) {
            showNotice("success", tRef.current("Profile Switched"), 1000);
          }
        } else {
          dispatchSwitch({
            type: "failure",
            profileId,
            error: tRef.current("Profile switch failed"),
          });
          switchCommandTokenRef.current = null;
          showNotice("error", tRef.current("Profile switch failed"));
        }

        await mutateProfilesRef.current?.();
      },
    );

    return () => {
      mounted = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [dispatchSwitch, setManualActivatings]);

  useEffect(() => {
    const active = switchState.active;
    if (!active) {
      switchCommandTokenRef.current = null;
      return;
    }
    if (switchCommandTokenRef.current === active.token) {
      return;
    }
    switchCommandTokenRef.current = active.token;
    let cancelled = false;
    const runSwitch = async () => {
      try {
        const accepted = await switchProfileCommand(
          active.profileId,
          active.notifySuccess,
        );
        if (!accepted) {
          throw new Error(t("Profile switch failed"));
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message || error?.toString?.() || String(error);
        showNotice("error", message);
        dispatchSwitch({
          type: "failure",
          profileId: active.profileId,
          error: message,
        });
        switchCommandTokenRef.current = null;
        await mutateProfiles();
      }
    };

    runSwitch();

    return () => {
      cancelled = true;
    };
  }, [dispatchSwitch, mutateProfiles, switchState.active, t]);

  const onSelect = useCallback(
    (targetProfile: string, force: boolean) => {
      if (!force && targetProfile === currentProfileId) {
        debugProfileSwitch("ALREADY_CURRENT_IGNORED", targetProfile);
        return;
      }
      enqueueSwitch(targetProfile, true);
    },
    [currentProfileId, enqueueSwitch],
  );

  useEffect(() => {
    if (!current) return;
    if (current === currentProfileId) return;
    if (switchActivatingIds.includes(current)) return;
    enqueueSwitch(current, false);
  }, [current, currentProfileId, enqueueSwitch, switchActivatingIds]);

  useEffect(() => {
    let mounted = true;
    const panicListener = listen<RustPanicPayload>("rust-panic", (event) => {
      if (!mounted) return;
      const payload = event.payload;
      if (!payload) return;
      showNotice(
        "error",
        `Rust panic: ${payload.message} @ ${payload.location}`,
      );
      console.error("Rust panic reported from backend:", payload);
    });
    return () => {
      mounted = false;
      panicListener.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [t]);

  const onEnhance = useLockFn(async (notifySuccess: boolean) => {
    if (switchingProfileId) {
      console.log(
        `[Profile] A profile is currently switching (${switchingProfileId}); skipping enhance operation`,
      );
      return;
    }

    const currentProfiles = currentActivatings();
    setManualActivatings((prev) => [...new Set([...prev, ...currentProfiles])]);

    try {
      await enhanceProfiles();
      mutateLogs();
      if (notifySuccess) {
        showNotice("success", t("Profile Reactivated"), 1000);
      }
    } catch (err: any) {
      showNotice("error", err.message || err.toString(), 3000);
    } finally {
      setManualActivatings([]);
    }
  });

  const onDelete = useLockFn(async (uid: string) => {
    const current = profiles.current === uid;
    try {
      setManualActivatings([...(current ? currentActivatings() : []), uid]);
      await deleteProfile(uid);
      mutateProfiles();
      mutateLogs();
      if (current) {
        await onEnhance(false);
      }
    } catch (err: any) {
      showNotice("error", err?.message || err.toString());
    } finally {
      setManualActivatings([]);
    }
  });

  // Update all profiles
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
        console.error(`Failed to update profile ${uid}:`, err);
      } finally {
        setLoadingCache((cache) => ({ ...cache, [uid]: false }));
      }
    };

    return new Promise((resolve) => {
      setLoadingCache((cache) => {
        // Gather profiles that are not updating
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
      return "none"; // no selection
    } else if (selectedProfiles.size === profileItems.length) {
      return "all"; // all selected
    } else {
      return "partial"; // partially selected
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

      setManualActivatings((prev) => [
        ...new Set([...prev, ...currentActivating]),
      ]);

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
      setManualActivatings([]);
    }
  });

  const mode = useThemeMode();
  const islight = mode === "light";
  const dividercolor = islight
    ? "rgba(0, 0, 0, 0.06)"
    : "rgba(255, 255, 255, 0.06)";

  // Observe configuration changes from backend
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

        console.log(`[Profile] Received profile-change event: ${newProfileId}`);

        if (
          lastProfileId === newProfileId &&
          now - lastUpdateTime < debounceDelay
        ) {
          console.log(`[Profile] Duplicate event throttled; skipping`);
          return;
        }

        lastProfileId = newProfileId;
        lastUpdateTime = now;

        console.log(`[Profile] Performing profile data refresh`);

        if (refreshTimer !== null) {
          window.clearTimeout(refreshTimer);
        }

        // Use async scheduling to avoid blocking event handling
        refreshTimer = window.setTimeout(() => {
          mutateProfiles().catch((error) => {
            console.error("[Profile] Profile data refresh failed:", error);
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

              {/* Fault detection and emergency recovery button */}
              {(error || isStale) && (
                <IconButton
                  size="small"
                  color="warning"
                  title="Data issue detected, click to force refresh"
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
          // Only trigger global reload when the active profile changes
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
