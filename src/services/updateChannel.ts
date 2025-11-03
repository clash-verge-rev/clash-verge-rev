import { useLocalStorage } from "foxact/use-local-storage";

export type UpdateChannel = "stable" | "autobuild";

export const UPDATE_CHANNEL_STORAGE_KEY = "update-channel";

export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = "stable";

export const UPDATE_CHANNEL_OPTIONS: Array<{
  value: UpdateChannel;
  labelKey: string;
}> = [
  { value: "stable", labelKey: "Update Channel Stable" },
  { value: "autobuild", labelKey: "Update Channel Autobuild" },
];

const isValidChannel = (value: unknown): value is UpdateChannel => {
  return value === "stable" || value === "autobuild";
};

export const useUpdateChannel = () =>
  useLocalStorage<UpdateChannel>(
    UPDATE_CHANNEL_STORAGE_KEY,
    DEFAULT_UPDATE_CHANNEL,
    {
      serializer: JSON.stringify,
      deserializer: (value) => {
        try {
          const parsed = JSON.parse(value);
          return isValidChannel(parsed) ? parsed : DEFAULT_UPDATE_CHANNEL;
        } catch (ignoreErr) {
          return DEFAULT_UPDATE_CHANNEL;
        }
      },
    },
  );

export const getStoredUpdateChannel = (): UpdateChannel => {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage === "undefined"
  ) {
    return DEFAULT_UPDATE_CHANNEL;
  }

  const raw = window.localStorage.getItem(UPDATE_CHANNEL_STORAGE_KEY);
  if (raw === null) {
    return DEFAULT_UPDATE_CHANNEL;
  }

  try {
    const parsed = JSON.parse(raw);
    return isValidChannel(parsed) ? parsed : DEFAULT_UPDATE_CHANNEL;
  } catch (ignoreErr) {
    return DEFAULT_UPDATE_CHANNEL;
  }
};
