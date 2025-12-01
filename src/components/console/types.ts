export type LogLevel =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "exception"
  | "debug";

export interface ColorScheme {
  // JSON syntax colors
  key: string;
  string: string;
  number: string;
  boolean: string;
  null: string;
  bracket: string;
  arrow: string;
  arrowHover: string;
  collapsed: string;
  // UI colors
  background: string;
  toolbar: string;
  border: string;
  text: string;
  textSecondary: string;
  inputBg: string;
  inputHover: string;
  focusRing: string;
  scrollThumb: string;
  scrollThumbHover: string;
  rowHover: string;
  // Log level colors
  errorBg: string;
  errorBorder: string;
  errorText: string;
  warnBg: string;
  warnBorder: string;
  warnText: string;
  infoText: string;
  logText: string;
  debugText: string;
  // Badge colors
  errorBadgeBg: string;
  errorBadgeText: string;
  warnBadgeBg: string;
  warnBadgeText: string;
  selectedBg: string;
  // Context menu colors
  menuBg: string;
  menuBorder: string;
  menuText: string;
  menuHoverBg: string;
  menuHoverText: string;
  menuSeparator: string;
}

export interface ContextMenuState {
  mouseX: number;
  mouseY: number;
  type: "primitive" | "object";
  path: string;
  value: unknown;
}

export interface JsonNodeRef {
  expandAll: () => void;
  collapseAll: () => void;
}
