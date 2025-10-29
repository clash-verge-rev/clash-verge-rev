import { create } from "zustand";

import type { SwitchResultStatus } from "@/services/cmds";

interface ProfileStoreState {
  data: IProfilesConfig | null;
  optimisticCurrent: string | null;
  isHydrating: boolean;
  lastEventSeq: number;
  lastResult: SwitchResultStatus | null;
  applySwitchResult: (result: SwitchResultStatus) => void;
  commitHydrated: (data: IProfilesConfig) => void;
  setLastEventSeq: (sequence: number) => void;
}

export const useProfileStore = create<ProfileStoreState>((set) => ({
  data: null,
  optimisticCurrent: null,
  isHydrating: false,
  lastEventSeq: 0,
  lastResult: null,
  applySwitchResult(result) {
    // Record the optimistic switch outcome so the UI reflects the desired profile immediately.
    set((state) => ({
      lastResult: result,
      optimisticCurrent: result.success ? result.profileId : null,
      isHydrating: result.success ? true : state.isHydrating,
    }));
  },
  commitHydrated(data) {
    set({
      data,
      optimisticCurrent: null,
      isHydrating: false,
    });
  },
  setLastEventSeq(sequence) {
    set({ lastEventSeq: sequence });
  },
}));

export const selectEffectiveProfiles = (state: ProfileStoreState) => {
  if (!state.data) {
    return null;
  }
  // Prefer the optimistic selection while hydration is pending.
  const current = state.optimisticCurrent ?? state.data.current;
  if (
    state.optimisticCurrent &&
    state.optimisticCurrent !== state.data.current
  ) {
    return { ...state.data, current } as IProfilesConfig;
  }
  return state.data;
};

export const selectIsHydrating = (state: ProfileStoreState) =>
  state.isHydrating;
export const selectLastResult = (state: ProfileStoreState) => state.lastResult;
