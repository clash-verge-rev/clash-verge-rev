const envVarValue = (import.meta.env.VITE_ENABLE_DEBUG_LOGS ?? "").toString();

let runtimeOverride: boolean | null = null;

const parseStringFlag = (value: string) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const isEnvDebugEnabled = () => {
  if (import.meta.env.DEV) {
    return true;
  }

  if (runtimeOverride !== null) {
    return runtimeOverride;
  }

  if (parseStringFlag(envVarValue)) {
    return true;
  }

  if (typeof window !== "undefined") {
    const globalFlag = (window as any).__VERGE_ENABLE_DEBUG_LOGS__;
    if (typeof globalFlag === "boolean") {
      return globalFlag;
    }

    try {
      const stored = window.localStorage?.getItem("VERGE_DEBUG_LOGS");
      if (stored) {
        return parseStringFlag(stored);
      }
    } catch {
      // ignore storage access errors
    }
  }

  return false;
};

export const setDebugLoggingEnabled = (enabled: boolean) => {
  runtimeOverride = enabled;
};

export const isDebugLoggingEnabled = () => isEnvDebugEnabled();

export const debugLog = (...args: any[]) => {
  if (!isEnvDebugEnabled()) return;
  console.log(...args);
};
