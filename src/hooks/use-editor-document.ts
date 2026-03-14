import { useCallback, useEffect, useState } from "react";

import { showNotice } from "@/services/notice-service";

interface UseEditorDocumentOptions {
  open: boolean;
  load: () => Promise<string>;
}

export const useEditorDocument = ({ open, load }: UseEditorDocumentOptions) => {
  const [value, setValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) return;

    /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
    setValue("");
    setSavedValue("");
    setLoading(true);
    /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect */
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    load()
      .then((nextValue) => {
        if (cancelled) return;

        const normalized = nextValue ?? "";
        setValue(normalized);
        setSavedValue(normalized);
      })
      .catch((error) => {
        if (!cancelled) showNotice.error(error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, open]);

  const markSaved = useCallback((nextValue: string) => {
    setSavedValue(nextValue);
  }, []);

  const dirty = value !== savedValue;

  return {
    value,
    setValue,
    savedValue,
    loading,
    dirty,
    markSaved,
  };
};
