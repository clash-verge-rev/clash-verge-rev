import type { getProxies } from "tauri-plugin-mihomo-api";
import { create } from "zustand";

import {
  ProxiesView,
  ProxyProviderRecord,
  buildProxyView,
  calcuProxies,
  getCachedProxyProviders,
  setCachedProxyProviders,
} from "@/services/cmds";
import { AsyncEventQueue, nextTick } from "@/utils/asyncQueue";

type ProxyHydration = "none" | "snapshot" | "live";
type RawProxiesResponse = Awaited<ReturnType<typeof getProxies>>;

export interface ProxiesUpdatedPayload {
  proxies: RawProxiesResponse;
  providers?: Record<string, unknown> | null;
  emittedAt?: number;
  profileId?: string | null;
}

interface ProxyStoreState {
  data: ProxiesView | null;
  hydration: ProxyHydration;
  lastUpdated: number | null;
  lastProfileId: string | null;
  liveFetchRequestId: number;
  lastAppliedFetchId: number;
  pendingProfileId: string | null;
  pendingSnapshotFetchId: number | null;
  setSnapshot: (snapshot: ProxiesView, profileId: string) => void;
  setLive: (payload: ProxiesUpdatedPayload) => void;
  startLiveFetch: () => number;
  completeLiveFetch: (requestId: number, view: ProxiesView) => void;
  clearPendingProfile: () => void;
  reset: () => void;
}

const normalizeProviderPayload = (
  raw: ProxiesUpdatedPayload["providers"],
): ProxyProviderRecord | null => {
  if (!raw || typeof raw !== "object") return null;

  const rawRecord = raw as Record<string, any>;
  const source =
    rawRecord.providers && typeof rawRecord.providers === "object"
      ? (rawRecord.providers as Record<string, any>)
      : rawRecord;

  const entries = Object.entries(source)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, value]) => {
      if (!value || typeof value !== "object") {
        return false;
      }
      const vehicleType = value.vehicleType;
      return vehicleType === "HTTP" || vehicleType === "File";
    })
    .map(([name, value]) => {
      const normalized: IProxyProviderItem = {
        name: value.name ?? name,
        type: value.type ?? "",
        proxies: Array.isArray(value.proxies) ? value.proxies : [],
        updatedAt: value.updatedAt ?? "",
        vehicleType: value.vehicleType ?? "",
        subscriptionInfo:
          value.subscriptionInfo && typeof value.subscriptionInfo === "object"
            ? {
                Upload: Number(value.subscriptionInfo.Upload ?? 0),
                Download: Number(value.subscriptionInfo.Download ?? 0),
                Total: Number(value.subscriptionInfo.Total ?? 0),
                Expire: Number(value.subscriptionInfo.Expire ?? 0),
              }
            : undefined,
      };

      return [name, normalized] as const;
    });

  return Object.fromEntries(entries) as ProxyProviderRecord;
};

export const useProxyStore = create<ProxyStoreState>((set, get) => ({
  data: null,
  hydration: "none",
  lastUpdated: null,
  lastProfileId: null,
  liveFetchRequestId: 0,
  lastAppliedFetchId: 0,
  pendingProfileId: null,
  pendingSnapshotFetchId: null,
  setSnapshot(snapshot, profileId) {
    const stateBefore = get();

    set((state) => ({
      data: snapshot,
      hydration: "snapshot",
      lastUpdated: null,
      pendingProfileId: profileId,
      pendingSnapshotFetchId: state.liveFetchRequestId,
    }));

    const hasLiveHydration =
      stateBefore.hydration === "live" &&
      stateBefore.lastProfileId === profileId;

    if (profileId && !hasLiveHydration) {
      void fetchLiveProxies().catch((error) => {
        console.warn(
          "[ProxyStore] Failed to bootstrap live proxies from snapshot:",
          error,
        );
        scheduleBootstrapLiveFetch(800);
      });
    }
  },
  setLive(payload) {
    const state = get();
    const emittedAt = payload.emittedAt ?? Date.now();

    if (
      state.hydration === "live" &&
      state.lastUpdated !== null &&
      emittedAt <= state.lastUpdated
    ) {
      return;
    }

    const providersRecord =
      normalizeProviderPayload(payload.providers) ?? getCachedProxyProviders();

    if (providersRecord) {
      setCachedProxyProviders(providersRecord);
    }

    const view = buildProxyView(payload.proxies, providersRecord);
    const nextProfileId = payload.profileId ?? state.lastProfileId;

    set((current) => ({
      data: view,
      hydration: "live",
      lastUpdated: emittedAt,
      lastProfileId: nextProfileId ?? null,
      lastAppliedFetchId: current.liveFetchRequestId,
      pendingProfileId: null,
      pendingSnapshotFetchId: null,
    }));
  },
  startLiveFetch() {
    let nextRequestId = 0;
    set((state) => {
      nextRequestId = state.liveFetchRequestId + 1;
      return {
        liveFetchRequestId: nextRequestId,
      };
    });
    return nextRequestId;
  },
  completeLiveFetch(requestId, view) {
    const state = get();
    if (requestId <= state.lastAppliedFetchId) {
      return;
    }

    const shouldAdoptPending =
      state.pendingProfileId !== null &&
      requestId >= (state.pendingSnapshotFetchId ?? 0);

    set({
      data: view,
      hydration: "live",
      lastUpdated: Date.now(),
      lastProfileId: shouldAdoptPending
        ? state.pendingProfileId
        : state.lastProfileId,
      lastAppliedFetchId: requestId,
      pendingProfileId: shouldAdoptPending ? null : state.pendingProfileId,
      pendingSnapshotFetchId: shouldAdoptPending
        ? null
        : state.pendingSnapshotFetchId,
    });
  },
  clearPendingProfile() {
    set({
      pendingProfileId: null,
      pendingSnapshotFetchId: null,
    });
  },
  reset() {
    set({
      data: null,
      hydration: "none",
      lastUpdated: null,
      lastProfileId: null,
      liveFetchRequestId: 0,
      lastAppliedFetchId: 0,
      pendingProfileId: null,
      pendingSnapshotFetchId: null,
    });
    scheduleBootstrapLiveFetch(200);
  },
}));

const liveApplyQueue = new AsyncEventQueue();
let pendingLivePayload: ProxiesUpdatedPayload | null = null;
let liveApplyScheduled = false;

const scheduleLiveApply = () => {
  if (liveApplyScheduled) return;
  liveApplyScheduled = true;

  const dispatch = () => {
    liveApplyScheduled = false;
    const payload = pendingLivePayload;
    pendingLivePayload = null;
    if (!payload) return;

    liveApplyQueue.enqueue(async () => {
      await nextTick();
      useProxyStore.getState().setLive(payload);
    });
  };

  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    window.requestAnimationFrame(dispatch);
  } else {
    setTimeout(dispatch, 16);
  }
};

export const applyLiveProxyPayload = (payload: ProxiesUpdatedPayload) => {
  pendingLivePayload = payload;
  scheduleLiveApply();
};

export const fetchLiveProxies = async () => {
  const requestId = useProxyStore.getState().startLiveFetch();
  const view = await calcuProxies();
  useProxyStore.getState().completeLiveFetch(requestId, view);
};

const MAX_BOOTSTRAP_BACKOFF_STEP = 5;
const BOOTSTRAP_BASE_DELAY_MS = 600;
const BOOTSTRAP_SLOW_RETRY_MS = 5000;
let bootstrapAttempts = 0;
let bootstrapTimer: number | null = null;

function attemptBootstrapLiveFetch() {
  const state = useProxyStore.getState();
  if (state.hydration === "live") {
    bootstrapAttempts = 0;
    return;
  }

  const attemptNumber = ++bootstrapAttempts;

  void fetchLiveProxies()
    .then(() => {
      bootstrapAttempts = 0;
    })
    .catch((error) => {
      console.warn(
        `[ProxyStore] Bootstrap live fetch attempt ${attemptNumber} failed:`,
        error,
      );
      const backoffStep = Math.min(attemptNumber, MAX_BOOTSTRAP_BACKOFF_STEP);
      const nextDelay =
        attemptNumber <= MAX_BOOTSTRAP_BACKOFF_STEP
          ? BOOTSTRAP_BASE_DELAY_MS * backoffStep
          : BOOTSTRAP_SLOW_RETRY_MS;
      scheduleBootstrapLiveFetch(nextDelay);
    });
}

function scheduleBootstrapLiveFetch(delay = 0) {
  if (typeof window === "undefined") {
    return;
  }

  if (bootstrapTimer !== null) {
    window.clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
  }

  bootstrapTimer = window.setTimeout(() => {
    bootstrapTimer = null;
    attemptBootstrapLiveFetch();
  }, delay);
}

if (typeof window !== "undefined") {
  void nextTick().then(() => scheduleBootstrapLiveFetch(0));
}
