/**
 * Debug logging is enabled when:
 * - dev build (`import.meta.env.DEV`)
 * - env flag `VITE_ENABLE_DEBUG_LOGS` is truthy (1/true/yes)
 * - page sets `window.__VERGE_ENABLE_DEBUG_LOGS__ = true`
 * - localStorage item `VERGE_DEBUG_LOGS` is truthy (1/true/yes)
 * Use `setDebugLoggingEnabled` to force-enable/disable at runtime.
 */
let runtimeOverride: boolean | undefined;
let cachedDebugEnabled: boolean | undefined;

const parseStringFlag = (value: unknown) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const readGlobalFlag = (): boolean | null => {
  if (typeof window === "undefined") return null;
  const flag = (window as any).__VERGE_ENABLE_DEBUG_LOGS__;
  return typeof flag === "boolean" ? flag : null;
};

const readStoredFlag = (): boolean | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage?.getItem("VERGE_DEBUG_LOGS");
    return stored ? parseStringFlag(stored) : null;
  } catch {
    return null;
  }
};

const computeDebugEnabled = (): boolean => {
  if (import.meta.env.DEV) return true;
  if (parseStringFlag(import.meta.env.VITE_ENABLE_DEBUG_LOGS)) return true;

  const globalFlag = readGlobalFlag();
  if (globalFlag !== null) return globalFlag;

  const storedFlag = readStoredFlag();
  if (storedFlag !== null) return storedFlag;

  return false;
};

export const setDebugLoggingEnabled = (enabled: boolean) => {
  runtimeOverride = enabled;
  cachedDebugEnabled = enabled;
};

export const isDebugLoggingEnabled = () =>
  runtimeOverride ??
  cachedDebugEnabled ??
  (cachedDebugEnabled = computeDebugEnabled());

/**
 * Logs to the console only when debug logging is enabled.
 * Forwards all arguments to `console.log`; does nothing otherwise.
 */
export const debugLog = (...args: any[]) => {
  if (!isDebugLoggingEnabled()) return;
  console.log(...args);
};
