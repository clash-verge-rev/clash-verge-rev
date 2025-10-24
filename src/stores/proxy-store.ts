import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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
type ProxyHydration = "none" | "snapshot" | "live";
type RawProxiesResponse = Awaited<ReturnType<typeof getProxies>>;

export interface ProxiesUpdatedPayload {
  proxies: RawProxiesResponse;
  providers?: ProxyProviderRecord | Record<string, unknown> | null;
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
  setSnapshot: (snapshot: ProxiesView, profileId: string) => void;
  setLive: (payload: ProxiesUpdatedPayload) => void;
  startLiveFetch: () => number;
  completeLiveFetch: (requestId: number, view: ProxiesView) => void;
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
  setSnapshot(snapshot, profileId) {
    set((state) => ({
      data: snapshot,
      hydration: "snapshot",
      lastUpdated: null,
      lastProfileId: profileId,
      lastAppliedFetchId: state.liveFetchRequestId,
    }));
  },
  setLive(payload) {
    const state = get();
    const emittedAt = payload.emittedAt ?? Date.now();

    const shouldIgnoreStaleEvent =
      state.hydration === "live" &&
      state.lastUpdated !== null &&
      emittedAt <= state.lastUpdated;

    if (shouldIgnoreStaleEvent) {
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

    set({
      data: view,
      hydration: "live",
      lastUpdated: Date.now(),
      lastProfileId: state.lastProfileId,
      lastAppliedFetchId: requestId,
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
    });
  },
}));

let bridgePromise: Promise<UnlistenFn> | null = null;

export const ensureProxyEventBridge = () => {
  if (!bridgePromise) {
    bridgePromise = listen<ProxiesUpdatedPayload>(
      "proxies-updated",
      (event) => {
        useProxyStore.getState().setLive(event.payload);
      },
    )
      .then((unlisten) => {
        let released = false;
        return () => {
          if (released) return;
          released = true;
          unlisten();
          bridgePromise = null;
        };
      })
      .catch((error) => {
        bridgePromise = null;
        throw error;
      });
  }

  return bridgePromise;
};

export const fetchLiveProxies = async () => {
  const requestId = useProxyStore.getState().startLiveFetch();
  const view = await calcuProxies();
  useProxyStore.getState().completeLiveFetch(requestId, view);
};
