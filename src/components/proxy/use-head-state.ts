import { useCallback, useEffect, useState } from "react";
import { useRecoilValue } from "recoil";
import { atomCurrentProfile } from "../../services/states";
import { ProxySortType } from "./use-sort-proxy";

export interface HeadState {
  open?: boolean;
  showType: boolean;
  sortType: ProxySortType;
  filterText: string;
  textState: "url" | "filter" | null;
  testUrl: string;
}

type HeadStateStorage = Record<string, Record<string, HeadState>>;

const HEAD_STATE_KEY = "proxy-head-state";
const DEFAULT_STATE: HeadState = {
  open: false,
  showType: false,
  sortType: 0,
  filterText: "",
  textState: null,
  testUrl: "",
};

export default function useHeadState(groupName: string) {
  const current = useRecoilValue(atomCurrentProfile);

  const [state, setState] = useState<HeadState>(DEFAULT_STATE);

  useEffect(() => {
    if (!current) {
      setState(DEFAULT_STATE);
      return;
    }

    try {
      const data = JSON.parse(
        localStorage.getItem(HEAD_STATE_KEY)!
      ) as HeadStateStorage;

      const value = data[current][groupName] || DEFAULT_STATE;

      if (value && typeof value === "object") {
        setState({ ...DEFAULT_STATE, ...value });
      } else {
        setState(DEFAULT_STATE);
      }
    } catch {}
  }, [current, groupName]);

  const setHeadState = useCallback(
    (obj: Partial<HeadState>) => {
      setState((old) => {
        const ret = { ...old, ...obj };

        setTimeout(() => {
          try {
            const item = localStorage.getItem(HEAD_STATE_KEY);

            let data = (item ? JSON.parse(item) : {}) as HeadStateStorage;

            if (!data || typeof data !== "object") data = {};
            if (!data[current]) data[current] = {};

            data[current][groupName] = ret;

            localStorage.setItem(HEAD_STATE_KEY, JSON.stringify(data));
          } catch {}
        });

        return ret;
      });
    },
    [current, groupName]
  );

  return [state, setHeadState] as const;
}
