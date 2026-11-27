import {
  check,
  type CheckOptions,
  type Update,
} from '@tauri-apps/plugin-updater'

// The plugin's version comparator is overridden in src-tauri/src/lib.rs, so an update
// returned by `check` is already installable and needs no extra filtering here.
export const checkForUpdate = async (
  options?: CheckOptions,
): Promise<Update | null> => {
  return check(options ?? {})
}
