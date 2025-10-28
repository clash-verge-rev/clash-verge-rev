import { create } from "zustand";

import { ProxiesView, calcuProxies } from "@/services/cmds";
type ProxyHydration = "none" | "snapshot" | "live";

interface ProxyStoreState {
  data: ProxiesView | null;
  hydration: ProxyHydration;
  lastUpdated: number | null;
  lastProfileId: string | null;
  liveFetchRequestId: number;
  lastAppliedFetchId: number;
  setSnapshot: (snapshot: ProxiesView, profileId: string) => void;
  startLiveFetch: () => number;
  completeLiveFetch: (requestId: number, view: ProxiesView) => void;
  reset: () => void;
}

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

export const fetchLiveProxies = async () => {
  const requestId = useProxyStore.getState().startLiveFetch();
  const view = await calcuProxies();
  useProxyStore.getState().completeLiveFetch(requestId, view);
};
