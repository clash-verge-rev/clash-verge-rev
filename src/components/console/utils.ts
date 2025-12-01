// Copy to clipboard helper
export const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
};

// Try to parse JSON string
export const tryParseJson = (
  str: string,
): { isJson: boolean; value: unknown } => {
  try {
    const trimmed = str.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      return { isJson: true, value: JSON.parse(trimmed) };
    }
    return { isJson: false, value: str };
  } catch {
    return { isJson: false, value: str };
  }
};

/** 统计信息 */
export interface ConsoleStats {
  error: number;
  warn: number;
  info: number;
  log: number;
}

/** 获取日志统计信息的工具函数 */
export const getConsoleStats = (logInfo: [string, string][]): ConsoleStats => {
  const counts = { error: 0, warn: 0, info: 0, log: 0 };
  logInfo.forEach(([level]) => {
    const key = level.toLowerCase();
    if (key === "error" || key === "exception") counts.error++;
    else if (key === "warn") counts.warn++;
    else if (key === "info") counts.info++;
    else counts.log++;
  });
  return counts;
};

// Get preview text for collapsed objects/arrays
export const getPreview = (value: unknown, maxLength = 80): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.slice(0, 3).map((v) => {
      if (typeof v === "string") return `"${v}"`;
      if (v === null) return "null";
      if (typeof v === "object") return Array.isArray(v) ? "[…]" : "{…}";
      return String(v);
    });
    const preview = `[${items.join(", ")}${value.length > 3 ? ", …" : ""}]`;
    return preview.length > maxLength
      ? preview.slice(0, maxLength) + "…"
      : preview;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const items = keys.slice(0, 3).map((k) => {
      const v = (value as Record<string, unknown>)[k];
      let valStr: string;
      if (typeof v === "string") valStr = `"${v}"`;
      else if (v === null) valStr = "null";
      else if (typeof v === "object") valStr = Array.isArray(v) ? "[…]" : "{…}";
      else valStr = String(v);
      return `${k}: ${valStr}`;
    });
    const preview = `{${items.join(", ")}${keys.length > 3 ? ", …" : ""}}`;
    return preview.length > maxLength
      ? preview.slice(0, maxLength) + "…"
      : preview;
  }
  return String(value);
};
