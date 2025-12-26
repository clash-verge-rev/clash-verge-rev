import { CloseRounded } from "@mui/icons-material";
import {
  Snackbar,
  Alert,
  IconButton,
  Box,
  type SnackbarOrigin,
} from "@mui/material";
import React, { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import {
  subscribeNotices,
  hideNotice,
  getSnapshotNotices,
} from "@/services/notice-service";
import type { TranslationKey } from "@/types/generated/i18n-keys";

type NoticePosition = NonNullable<IVergeConfig["notice_position"]>;

const VALID_POSITIONS: NoticePosition[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const resolvePosition = (position?: NoticePosition | null): NoticePosition => {
  if (position && VALID_POSITIONS.includes(position)) {
    return position;
  }
  return "top-right";
};

const getAnchorOrigin = (position: NoticePosition): SnackbarOrigin => {
  const [vertical, horizontal] = position.split("-") as [
    SnackbarOrigin["vertical"],
    SnackbarOrigin["horizontal"],
  ];
  return { vertical, horizontal };
};

interface NoticeManagerProps {
  position?: NoticePosition | null;
}

export const NoticeManager: React.FC<NoticeManagerProps> = ({ position }) => {
  const { t } = useTranslation();
  const resolvedPosition = useMemo(() => resolvePosition(position), [position]);
  const anchorOrigin = useMemo(
    () => getAnchorOrigin(resolvedPosition),
    [resolvedPosition],
  );
  const currentNotices = useSyncExternalStore(
    subscribeNotices,
    getSnapshotNotices,
  );

  const handleClose = (id: number) => {
    hideNotice(id);
  };

  return (
    <Box
      sx={{
        position: "fixed",
        top: anchorOrigin.vertical === "top" ? "20px" : "auto",
        bottom: anchorOrigin.vertical === "bottom" ? "20px" : "auto",
        left: anchorOrigin.horizontal === "left" ? "20px" : "auto",
        right: anchorOrigin.horizontal === "right" ? "20px" : "auto",
        zIndex: 1500,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        maxWidth: "360px",
      }}
    >
      {currentNotices.map((notice) => (
        <Snackbar
          key={notice.id}
          open={true}
          anchorOrigin={anchorOrigin}
          sx={{
            position: "relative",
            transform: "none",
            top: "auto",
            right: "auto",
            bottom: "auto",
            left: "auto",
            width: "100%",
          }}
        >
          <Alert
            severity={notice.type}
            variant="filled"
            sx={{ width: "100%" }}
            action={
              <IconButton
                size="small"
                color="inherit"
                onClick={() => handleClose(notice.id)}
              >
                <CloseRounded fontSize="inherit" />
              </IconButton>
            }
          >
            {notice.i18n
              ? (() => {
                  const params = (notice.i18n.params ?? {}) as Record<
                    string,
                    unknown
                  >;
                  const {
                    prefixKey,
                    prefixParams,
                    prefix,
                    message,
                    ...restParams
                  } = params;

                  const prefixKeyParams =
                    prefixParams &&
                    typeof prefixParams === "object" &&
                    prefixParams !== null
                      ? (prefixParams as Record<string, unknown>)
                      : undefined;

                  const resolvedPrefix =
                    typeof prefixKey === "string"
                      ? t(prefixKey as TranslationKey, {
                          defaultValue: prefixKey,
                          ...(prefixKeyParams ?? {}),
                          ...restParams,
                        })
                      : typeof prefix === "string"
                        ? prefix
                        : undefined;

                  const finalParams: Record<string, unknown> = {
                    ...restParams,
                  };
                  if (resolvedPrefix !== undefined) {
                    finalParams.prefix = resolvedPrefix;
                  }
                  if (typeof message === "string") {
                    finalParams.message = message;
                  }

                  const defaultValue =
                    resolvedPrefix && typeof message === "string"
                      ? `${resolvedPrefix} ${message}`
                      : typeof message === "string"
                        ? message
                        : undefined;

                  return t(notice.i18n.key as TranslationKey, {
                    defaultValue,
                    ...finalParams,
                  });
                })()
              : notice.message}
          </Alert>
        </Snackbar>
      ))}
    </Box>
  );
};
