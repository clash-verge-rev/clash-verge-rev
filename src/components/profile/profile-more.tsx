import JSIcon from "@/assets/image/js.svg?react";
import YamlIcon from "@/assets/image/yaml.svg?react";
import { EditorViewer, Notice } from "@/components/base";
import { viewProfile } from "@/services/cmds";
import { useThemeMode } from "@/services/states";
import {
  Block,
  CheckCircle,
  Delete,
  Edit,
  EditNote,
  FeaturedPlayListRounded,
  FileOpen,
} from "@mui/icons-material";
import {
  Badge,
  Box,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  SxProps,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmViewer } from "./confirm-viewer";
import { LogViewer } from "./log-viewer";
import { ProfileDiv } from "./profile-box";

interface Props {
  sx?: SxProps;
  selected: boolean;
  isDragging?: boolean;
  itemData: IProfileItem;
  enableNum: number;
  logInfo?: [string, string][];
  reactivating: boolean;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  onActivatedSave: () => void;
}

// profile enhanced item
export const ProfileMore = (props: Props) => {
  const {
    sx,
    selected,
    isDragging,
    itemData,
    logInfo = [],
    reactivating,
    onEnable,
    onDisable,
    onDelete,
    onEdit,
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

  const onEditInfo = () => {
    setAnchorEl(null);
    onEdit();
  };

  const onEditFile = () => {
    setAnchorEl(null);
    setFileOpen(true);
  };

  const onOpenFile = useLockFn(async () => {
    setAnchorEl(null);
    try {
      await viewProfile(itemData.uid);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const fnWrapper = (fn: () => void) => () => {
    setAnchorEl(null);
    return fn();
  };

  const hasError = !!logInfo.find((e) => e[0] === "exception");

  const enableMenu = [
    {
      label: "Disable",
      icon: <Block fontSize="small" color="primary" />,
      handler: fnWrapper(async () => {
        setToggling(true);
        await onDisable();
        setToggling(false);
      }),
    },
    {
      label: "Edit Info",
      icon: <EditNote fontSize="small" color="primary" />,
      handler: onEditInfo,
    },
    {
      label: "Edit File",
      icon: <Edit fontSize="small" color="primary" />,
      handler: onEditFile,
    },
    {
      label: "Open File",
      icon: <FileOpen fontSize="small" color="primary" />,
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

  const disableMenu = [
    {
      label: "Enable",
      icon: <CheckCircle fontSize="small" color="primary" />,
      handler: fnWrapper(async () => {
        setToggling(true);
        await onEnable();
        setToggling(false);
      }),
    },
    {
      label: "Edit Info",
      icon: <EditNote fontSize="small" color="primary" />,
      handler: onEditInfo,
    },
    {
      label: "Edit File",
      icon: <Edit fontSize="small" color="primary" />,
      handler: onEditFile,
    },
    {
      label: "Open File",
      icon: <FileOpen fontSize="small" color="primary" />,
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
        aria-selected={selected}
        onDoubleClick={() => onEditFile()}
        // onClick={() => onSelect(false)}
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
          <Typography
            width="calc(100% - 52px)"
            variant="h6"
            component="h2"
            noWrap
            title={itemData.name}>
            {itemData.name}
          </Typography>

          {type === "script" ? (
            <JSIcon width={25} height={25} fill="var(--primary-main)" />
          ) : (
            <YamlIcon width={25} height={25} fill="var(--primary-main)" />
          )}
        </Box>

        <Box sx={boxStyle}>
          {selected && type === "script" ? (
            hasError ? (
              <Badge color="error" variant="dot" overlap="circular">
                <IconButton
                  size="small"
                  edge="start"
                  color="error"
                  title={t("Script Console")}
                  onClick={() => setLogOpen(true)}>
                  <FeaturedPlayListRounded fontSize="inherit" />
                </IconButton>
              </Badge>
            ) : (
              <IconButton
                size="small"
                edge="start"
                color="inherit"
                title={t("Script Console")}
                onClick={() => setLogOpen(true)}>
                <FeaturedPlayListRounded fontSize="inherit" />
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
        MenuListProps={{ sx: { py: 0.5 } }}
        onContextMenu={(e) => {
          setAnchorEl(null);
          e.preventDefault();
        }}>
        {(selected ? enableMenu : disableMenu)
          .filter((item: any) => item.show !== false)
          .map((item) => (
            <MenuItem
              key={item.label}
              onClick={() => item.handler()}
              sx={[
                { minWidth: 120 },
                (theme) => {
                  return {
                    ...(item.label === "Delete" && {
                      color: theme.palette.error.main,
                    }),
                  };
                },
              ]}
              dense>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText>{t(item.label)}</ListItemText>
            </MenuItem>
          ))}
      </Menu>

      <EditorViewer
        open={fileOpen}
        mode="profile"
        scope={type === "merge" ? "merge" : "script"}
        language={type === "merge" ? "yaml" : "javascript"}
        property={uid}
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
          await onDelete();
          setToggling(false);
        }}
      />
      {selected && (
        <LogViewer
          open={logOpen}
          logInfo={logInfo}
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
