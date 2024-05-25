import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import {
  Box,
  Badge,
  Chip,
  Typography,
  MenuItem,
  Menu,
  IconButton,
  CircularProgress,
} from "@mui/material";
import { FeaturedPlayListRounded } from "@mui/icons-material";
import { viewProfile } from "@/services/cmds";
import { Notice } from "@/components/base";
import { EditorViewer } from "@/components/profile/editor-viewer";
import { ProfileBox } from "./profile-box";
import { LogViewer } from "./log-viewer";
import { ConfirmViewer } from "./confirm-viewer";

interface Props {
  selected: boolean;
  reactivating: boolean;
  itemData: IProfileItem;
  logInfo?: [string, string][];
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  onActivatedSave: () => void;
}

// profile enhanced item
export const ProfileMore = (props: Props) => {
  const {
    selected,
    reactivating,
    itemData,
    logInfo = [],
    onEnable,
    onDisable,
    onDelete,
    onEdit,
    onActivatedSave,
  } = props;

  const { uid, type } = itemData;
  const { t, i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<any>(null);
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
      handler: fnWrapper(async () => {
        setToggling(true);
        await onDisable();
        setToggling(false);
      }),
    },
    { label: "Edit Info", handler: onEditInfo },
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
    {
      label: "Delete",
      handler: () => {
        setAnchorEl(null);
        setConfirmOpen(true);
      },
    },
  ];

  const disableMenu = [
    {
      label: "Enable",
      handler: fnWrapper(async () => {
        setToggling(true);
        await onEnable();
        setToggling(false);
      }),
    },
    { label: "Edit Info", handler: onEditInfo },
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
    {
      label: "Delete",
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
      className={selected ? "enable-enhanced-item" : ""}
      sx={{
        display: "flex",
        flexGrow: "1",
        margin: "5px",
        width: "260px",
      }}
    >
      <ProfileBox
        aria-selected={selected}
        onDoubleClick={onEditFile}
        // onClick={() => onSelect(false)}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}
      >
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
            }}
          >
            <CircularProgress size={20} />
          </Box>
        )}
        <Box
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          mb={0.5}
        >
          <Typography
            width="calc(100% - 52px)"
            variant="h6"
            component="h2"
            noWrap
            title={itemData.name}
          >
            {itemData.name}
          </Typography>

          <Chip
            label={type}
            color="primary"
            size="small"
            variant="outlined"
            sx={{ height: 20, textTransform: "capitalize" }}
          />
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
                  onClick={() => setLogOpen(true)}
                >
                  <FeaturedPlayListRounded fontSize="inherit" />
                </IconButton>
              </Badge>
            ) : (
              <IconButton
                size="small"
                edge="start"
                color="inherit"
                title={t("Script Console")}
                onClick={() => setLogOpen(true)}
              >
                <FeaturedPlayListRounded fontSize="inherit" />
              </IconButton>
            )
          ) : (
            <Typography
              noWrap
              title={itemData.desc}
              sx={i18n.language === "zh" ? { width: "calc(100% - 75px)" } : {}}
            >
              {itemData.desc}
            </Typography>
          )}
        </Box>
      </ProfileBox>

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
        }}
      >
        {(selected ? enableMenu : disableMenu)
          .filter((item: any) => item.show !== false)
          .map((item) => (
            <MenuItem
              key={item.label}
              onClick={item.handler}
              sx={[
                { minWidth: 120 },
                (theme) => {
                  return {
                    color:
                      item.label === "Delete"
                        ? theme.palette.error.main
                        : undefined,
                  };
                },
              ]}
              dense
            >
              {t(item.label)}
            </MenuItem>
          ))}
      </Menu>

      <EditorViewer
        mode="profile"
        property={uid}
        open={fileOpen}
        language={type === "merge" ? "yaml" : "javascript"}
        schema={type === "merge" ? "merge" : undefined}
        onClose={() => setFileOpen(false)}
        onChange={() => {
          if (selected) {
            onActivatedSave();
          }
        }}
      />
      <ConfirmViewer
        title="Confirm deletion"
        message="This operation is not reversible"
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
