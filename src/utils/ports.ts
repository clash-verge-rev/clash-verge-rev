/**
 * Default port constants - must match Rust constants in src-tauri/src/constants.rs
 */
export const DEFAULT_PORTS = {
  REDIR: 7895,
  TPROXY: 7896,
  MIXED: 7897,
  SOCKS: 7898,
  HTTP: 7899,
} as const
