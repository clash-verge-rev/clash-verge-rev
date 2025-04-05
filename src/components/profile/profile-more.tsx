import JSIcon from "@/assets/image/js.svg?react";
import YamlIcon from "@/assets/image/yaml.svg?react";
import { Notice, ScrollableText } from "@/components/base";
import { LogViewer } from "@/components/profile/log-viewer";
import { ProfileEditorViewer } from "@/components/profile/profile-editor-viewer";
import { viewProfile } from "@/services/cmds";
import { useThemeMode } from "@/services/states";
import { cn } from "@/utils";
import {
  Block,
  CheckCircle,
  Delete,
  Edit,
  FileOpen,
  Terminal,
} from "@mui/icons-material";
import {
  Badge,
  BadgeProps,
  Box,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  styled,
  SxProps,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { Message } from "console-feed/lib/definitions/Component";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmViewer } from "./confirm-viewer";
import { ProfileDiv } from "./profile-box";

export interface LogMessage extends Message {
  exception?: string;
}
interface Props {
  sx?: SxProps;
  selected: boolean;
  isDragging?: boolean;
  itemData: IProfileItem;
  chainLogs?: Record<string, LogMessage[]>;
  reactivating: boolean;
  onToggleEnable: (enable: boolean) => void;
  onDelete?: () => Promise<void>;
  onActivatedSave: () => void;
}

const StyledBadge = styled(Badge)<BadgeProps>(({ theme }) => ({
  "& .MuiBadge-badge": {
    right: -2,
    top: 5,
    border: `2px solid ${theme.palette.background.paper}`,
    padding: "0 4px",
  },
}));

// profile enhanced item
export const ProfileMore = (props: Props) => {
  const {
    sx,
    selected,
    isDragging,
    itemData,
    chainLogs = {},
    reactivating,
    onToggleEnable,
    onDelete,
    onActivatedSave,
  } = props;

  const { uid, type } = itemData;
  const { t, i18n } = useTranslation();
  const themeMode = useThemeMode();
  const [anchorEl, setAnchorEl] = useState<any>(null);
  if (anchorEl && isDragging) {
    setAnchorEl(null);
  }
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [fileOpen, setFileOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  const onEditFile = () => {
    setAnchorEl(null);
    setFileOpen(true);
  };

  const onOpenFile = useLockFn(async () => {
    setAnchorEl(null);
    try {
      await viewProfile(uid);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const fnWrapper = (fn: () => void) => () => {
    setAnchorEl(null);
    return fn();
  };

  const logs = chainLogs[uid] || [];
  const hasError = !!logs.find((e) => e.exception);

  const menus = [
    {
      label: "Enable",
      icon: <CheckCircle fontSize="small" />,
      handler: fnWrapper(async () => {
        setToggling(true);
        onToggleEnable(true);
        setToggling(false);
      }),
    },
    {
      label: "Edit",
      icon: <Edit fontSize="small" />,
      handler: onEditFile,
    },
    {
      label: "Open File",
      icon: <FileOpen fontSize="small" />,
      handler: onOpenFile,
    },
    {
      label: "Delete",
      icon: <Delete fontSize="small" color="error" />,
      handler: () => {
        setAnchorEl(null);
        setConfirmOpen(true);
      },
    },
  ];

  if (selected) {
    menus.splice(0, 1, {
      label: "Disable",
      icon: <Block fontSize="small" />,
      handler: fnWrapper(async () => {
        setToggling(true);
        onToggleEnable(false);
        setToggling(false);
      }),
    });
  }

  const boxStyle = {
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    lineHeight: 1,
  };

  return (
    <Box
      sx={{
        width: "100%",
        bgcolor: themeMode === "light" ? "#FFFFFF" : "#282A36",
        borderRadius: "8px",
        ...sx,
      }}>
      <ProfileDiv
        aria-label={isDragging ? "dragging" : "script"}
        aria-selected={selected || itemData.enable}
        onDoubleClick={() => onEditFile()}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}>
        {(reactivating || toggling) && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              backdropFilter: "blur(2px)",
              borderRadius: "8px",
            }}>
            <CircularProgress size={20} />
          </Box>
        )}
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={0.5}>
          <div className="w-[calc(100%-52px)]">
            <ScrollableText>
              <Typography
                title={itemData.name}
                variant="h6"
                component="h2"
                noWrap>
                {itemData.name}
              </Typography>
            </ScrollableText>
          </div>

          {type === "script" ? (
            <JSIcon width={25} height={25} fill="var(--primary-main)" />
          ) : (
            <YamlIcon width={25} height={25} fill="var(--primary-main)" />
          )}
        </Box>

        <Box sx={boxStyle}>
          {selected && type === "script" ? (
            hasError ? (
              <IconButton
                size="small"
                edge="start"
                color="error"
                title={t("Script Console")}
                onClick={() => setLogOpen(true)}>
                <Badge color="error" variant="dot">
                  <Terminal fontSize="medium" />
                </Badge>
              </IconButton>
            ) : (
              <IconButton
                size="small"
                edge="start"
                color="inherit"
                title={t("Script Console")}
                onClick={() => setLogOpen(true)}>
                <StyledBadge badgeContent={logs.length} color="primary">
                  <Terminal fontSize="medium" />
                </StyledBadge>
              </IconButton>
            )
          ) : (
            <Typography
              noWrap
              title={itemData.desc}
              sx={{
                ...(i18n.language === "zh" && { width: "calc(100% - 75px)" }),
              }}>
              {itemData.desc}
            </Typography>
          )}
        </Box>
      </ProfileDiv>

      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorPosition={position}
        anchorReference="anchorPosition"
        transitionDuration={225}
        slotProps={{ list: { sx: { py: 0.5 } } }}
        onContextMenu={(e) => {
          setAnchorEl(null);
          e.preventDefault();
        }}>
        {menus
          .filter((item: any) => item.show !== false)
          .map((item) => (
            <MenuItem
              key={item.label}
              onClick={() => item.handler()}
              sx={{ minWidth: 120 }}
              dense>
              <ListItemIcon className="!text-primary-main">
                {item.icon}
              </ListItemIcon>
              <ListItemText
                className={cn("text-primary-main", {
                  "text-error-main": item.label === "Delete",
                })}>
                {t(item.label)}
              </ListItemText>
            </MenuItem>
          ))}
      </Menu>

      <ProfileEditorViewer
        open={fileOpen}
        profileItem={itemData}
        type={type === "merge" ? "merge" : "script"}
        language={type === "merge" ? "yaml" : "javascript"}
        chainLogs={chainLogs}
        onChange={() => {
          if (selected) {
            onActivatedSave();
          }
        }}
        onClose={() => setFileOpen(false)}
      />
      <ConfirmViewer
        title={t("Confirm deletion")}
        message={t("This operation is not reversible")}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          setToggling(true);
          await onDelete?.();
          setToggling(false);
        }}
      />
      {selected && (
        <LogViewer
          open={logOpen}
          logInfo={logs}
          onClose={() => setLogOpen(false)}
        />
      )}
    </Box>
  );
};

function parseExpire(expire?: number) {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
}
