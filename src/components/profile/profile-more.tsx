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
} from "@mui/material";
import { FeaturedPlayListRounded } from "@mui/icons-material";
import { viewProfile } from "@/services/cmds";
import { Notice } from "@/components/base";
import { EditorViewer } from "./editor-viewer";
import { ProfileBox } from "./profile-box";
import { LogViewer } from "./log-viewer";

interface Props {
  selected: boolean;
  itemData: IProfileItem;
  enableNum: number;
  logInfo?: [string, string][];
  onEnable: () => void;
  onDisable: () => void;
  onMoveTop: () => void;
  onMoveEnd: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

// profile enhanced item
export const ProfileMore = (props: Props) => {
  const {
    selected,
    itemData,
    enableNum,
    logInfo = [],
    onEnable,
    onDisable,
    onMoveTop,
    onMoveEnd,
    onDelete,
    onEdit,
  } = props;

  const { uid, type } = itemData;
  const { t, i18n } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [fileOpen, setFileOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

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
  const showMove = enableNum > 1 && !hasError;

  const enableMenu = [
    { label: "Disable", handler: fnWrapper(onDisable) },
    { label: "Edit Info", handler: onEditInfo },
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
    { label: "To Top", show: showMove, handler: fnWrapper(onMoveTop) },
    { label: "To End", show: showMove, handler: fnWrapper(onMoveEnd) },
    { label: "Delete", handler: fnWrapper(onDelete) },
  ];

  const disableMenu = [
    { label: "Enable", handler: fnWrapper(onEnable) },
    { label: "Edit Info", handler: onEditInfo },
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
    { label: "Delete", handler: fnWrapper(onDelete) },
  ];

  const boxStyle = {
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    lineHeight: 1,
  };

  return (
    <>
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
                  title="Console"
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
                title="Console"
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

          <Typography
            noWrap
            component="span"
            title={`Updated Time: ${parseExpire(itemData.updated)}`}
            style={{ fontSize: 14 }}
          >
            {!!itemData.updated
              ? dayjs(itemData.updated! * 1000).fromNow()
              : ""}
          </Typography>
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
              sx={{ minWidth: 120 }}
              dense
            >
              {t(item.label)}
            </MenuItem>
          ))}
      </Menu>

      <EditorViewer
        uid={uid}
        open={fileOpen}
        mode={type === "merge" ? "yaml" : "javascript"}
        onClose={() => setFileOpen(false)}
      />

      {selected && (
        <LogViewer
          open={logOpen}
          logInfo={logInfo}
          onClose={() => setLogOpen(false)}
        />
      )}
    </>
  );
};

function parseExpire(expire?: number) {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
}
