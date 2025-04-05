import { LogViewer } from "@/components/profile/log-viewer";
import { LogMessage } from "@/components/profile/profile-more";
import { deleteProfile, patchProfile } from "@/services/cmds";
import { cn } from "@/utils";
import {
  CheckCircle,
  CircleOutlined,
  Delete,
  Edit,
  Terminal,
} from "@mui/icons-material";
import {
  alpha,
  Badge,
  BadgeProps,
  Box,
  CircularProgress,
  IconButton,
  styled,
  Tooltip,
} from "@mui/material";
import { t } from "i18next";
import { useRef, useState } from "react";
import { ScrollableText } from "../base";
import { useCustomTheme } from "../layout/use-custom-theme";
import { ProfileViewer, ProfileViewerRef } from "./profile-viewer";

interface Props {
  item: IProfileItem;
  isDragging?: boolean;
  reactivating?: boolean;
  selected: boolean;
  logs?: LogMessage[];
  onToggleEnableCallback?: (enable: boolean) => Promise<void>;
  onClick?: () => Promise<void>;
  onInfoChangeCallback?: () => Promise<void>;
  onDeleteCallback?: () => Promise<void>;
}

export default function ProfileMoreMini(props: Props) {
  const {
    item,
    isDragging,
    reactivating,
    selected,
    logs,
    onToggleEnableCallback,
    onClick,
    onInfoChangeCallback,
    onDeleteCallback,
  } = props;
  const viewerRef = useRef<ProfileViewerRef>(null);
  const [toggleEnabling, setToggleEnabling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [logOpen, setLogOpen] = useState(false);
  const { theme } = useCustomTheme();

  const isScriptMerge = item.type === "script";
  const hasError = isScriptMerge && !!logs?.find((item) => item.exception);
  const unselectedbackgroundColor =
    theme.palette.mode === "light" ? "#ffffff" : "#282A36";
  const selectedBackgroundColor =
    theme.palette.mode === "light"
      ? alpha(theme.palette.primary.main, 0.25)
      : alpha(theme.palette.primary.main, 0.35);
  const draggingBackgroundColor =
    theme.palette.mode === "light"
      ? alpha(theme.palette.primary.main, 0.45)
      : alpha(theme.palette.primary.main, 0.55);

  return (
    <>
      <div className="bg-comment my-2 flex h-[56px] w-full cursor-pointer items-center justify-between rounded-md">
        <div
          style={{
            backgroundColor: item.enable
              ? isDragging
                ? draggingBackgroundColor
                : selectedBackgroundColor
              : isDragging
                ? draggingBackgroundColor
                : unselectedbackgroundColor,
          }}
          className={cn(
            "relative flex h-full w-full items-center justify-between overflow-hidden rounded-md p-1 shadow-xs",
            {
              "border-primary-main border-0 border-l-2! border-solid":
                item.enable,
              "border-primary-main border border-solid": selected,
            },
          )}>
          <div className="flex h-full w-8 flex-col items-center justify-center">
            <IconButton
              loading={toggleEnabling}
              aria-label="toggle-enable"
              className="mr-1"
              size="small"
              onClick={async () => {
                try {
                  setToggleEnabling(true);
                  const nextEnable = !item.enable;
                  await patchProfile(item.uid, { ...item, enable: nextEnable });
                  await onToggleEnableCallback?.(nextEnable);
                } finally {
                  setToggleEnabling(false);
                }
              }}>
              <>
                {!toggleEnabling && item.enable ? (
                  <CheckCircle fontSize="inherit" color="primary" />
                ) : (
                  <CircleOutlined fontSize="inherit" />
                )}
              </>
            </IconButton>
            <div className="bg-primary-alpha text-primary-main dark:text-primary-main w-full cursor-pointer rounded-xs px-1 text-center text-xs">
              {item.type === "merge" ? "YML" : "JS"}
            </div>
          </div>

          <div
            className="ml-2 box-border flex w-full flex-col items-center overflow-hidden text-sm"
            onClick={onClick}>
            <div className="text-primary-main w-full">
              <ScrollableText>{item.name}</ScrollableText>
            </div>
            <div className="text-secondary-text w-full text-xs">
              <ScrollableText>{item.desc}</ScrollableText>
            </div>
          </div>

          {isScriptMerge && (
            <Tooltip title={t("Runtime Console")} placement="top">
              <IconButton
                aria-label="terminal"
                size="small"
                color="primary"
                className="mr-1"
                onClick={() => setLogOpen(true)}>
                {hasError ? (
                  <Badge color="error" variant="dot">
                    <Terminal color="error" fontSize="inherit" />
                  </Badge>
                ) : (
                  <StyledBadge badgeContent={logs?.length} color="primary">
                    <Terminal color="primary" fontSize="inherit" />
                  </StyledBadge>
                )}
              </IconButton>
            </Tooltip>
          )}

          <IconButton
            size="small"
            color="primary"
            onClick={() => viewerRef.current?.edit(item)}>
            <Edit fontSize="inherit" />
          </IconButton>

          {(deleting || reactivating) && (
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 10,
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                borderRadius: "8px",
                backdropFilter: "blur(2px)",
              }}>
              <CircularProgress size={20} />
            </Box>
          )}
        </div>

        <div className="ml-1 flex h-full w-fit items-center rounded-md">
          <IconButton
            aria-label="delete"
            size="small"
            onClick={async () => {
              try {
                setDeleting(true);
                await deleteProfile(item.uid);
                await onDeleteCallback?.();
              } finally {
                setDeleting(false);
              }
            }}>
            <Delete fontSize="inherit" color="error" />
          </IconButton>
        </div>
      </div>

      <ProfileViewer
        ref={viewerRef}
        onChange={async () => await onInfoChangeCallback?.()}
      />

      {isScriptMerge && (
        <LogViewer
          open={logOpen}
          logInfo={logs || []}
          onClose={() => setLogOpen(false)}
        />
      )}
    </>
  );
}

const StyledBadge = styled(Badge)<BadgeProps>(({ theme }) => ({
  "& .MuiBadge-badge": {
    right: 0,
    top: 3,
    border: `2px solid ${theme.palette.background.paper}`,
    padding: "0 4px",
  },
}));
