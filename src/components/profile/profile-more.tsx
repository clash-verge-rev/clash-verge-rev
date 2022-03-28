import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLockFn } from "ahooks";
import {
  alpha,
  Box,
  Chip,
  styled,
  Typography,
  MenuItem,
  Menu,
} from "@mui/material";
import { CmdType } from "../../services/types";
import { viewProfile } from "../../services/cmds";
import getSystem from "../../utils/get-system";
import enhance from "../../services/enhance";
import ProfileEdit from "./profile-edit";
import FileEditor from "./file-editor";
import Notice from "../base/base-notice";

const Wrapper = styled(Box)(({ theme }) => ({
  width: "100%",
  display: "block",
  cursor: "pointer",
  textAlign: "left",
  borderRadius: theme.shape.borderRadius,
  boxShadow: theme.shadows[2],
  padding: "8px 16px",
  boxSizing: "border-box",
}));

const OS = getSystem();

interface Props {
  selected: boolean;
  itemData: CmdType.ProfileItem;
  onEnable: () => void;
  onDisable: () => void;
  onMoveTop: () => void;
  onMoveEnd: () => void;
  onDelete: () => void;
  onEnhance: () => void;
}

// profile enhanced item
const ProfileMore = (props: Props) => {
  const {
    selected,
    itemData,
    onEnable,
    onDisable,
    onMoveTop,
    onMoveEnd,
    onDelete,
    onEnhance,
  } = props;

  const { uid, type } = itemData;
  const { t } = useTranslation();

  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [editOpen, setEditOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [status, setStatus] = useState(enhance.status(uid));

  // unlisten when unmount
  useEffect(() => enhance.listen(uid, setStatus), [uid]);

  // error during enhanced mode
  const hasError = selected && status?.status === "error";

  const onEditInfo = () => {
    setAnchorEl(null);
    setEditOpen(true);
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

  const enableMenu = [
    { label: "Disable", handler: fnWrapper(onDisable) },
    { label: "Refresh", handler: fnWrapper(onEnhance) },
    { label: "Edit Info", handler: onEditInfo },
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
    { label: "To Top", show: !hasError, handler: fnWrapper(onMoveTop) },
    { label: "To End", show: !hasError, handler: fnWrapper(onMoveEnd) },
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
      <Wrapper
        sx={({ palette }) => {
          // todo
          // 区分 selected 和 error 和 mode 下各种颜色的排列组合
          const { mode, primary, text, grey, error } = palette;
          const key = `${mode}-${selected}`;
          const bgkey = hasError ? `${mode}-err` : key;

          const bgcolor = {
            "light-true": alpha(primary.main, 0.15),
            "light-false": palette.background.paper,
            "dark-true": alpha(primary.main, 0.35),
            "dark-false": alpha(grey[700], 0.35),
            "light-err": alpha(error.main, 0.12),
            "dark-err": alpha(error.main, 0.3),
          }[bgkey]!;

          const color = {
            "light-true": text.secondary,
            "light-false": text.secondary,
            "dark-true": alpha(text.secondary, 0.6),
            "dark-false": alpha(text.secondary, 0.6),
          }[key]!;

          const h2color = {
            "light-true": primary.main,
            "light-false": text.primary,
            "dark-true": primary.light,
            "dark-false": text.primary,
          }[key]!;

          return { bgcolor, color, "& h2": { color: h2color } };
        }}
        // onClick={() => onSelect(false)}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center">
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
            sx={{ textTransform: "capitalize" }}
          />
        </Box>

        <Box sx={boxStyle}>
          {hasError ? (
            <Typography
              noWrap
              color="error"
              sx={{ width: "calc(100% - 75px)" }}
              title={status.message}
            >
              {status.message}
            </Typography>
          ) : (
            <Typography
              noWrap
              title={itemData.desc}
              sx={{ width: "calc(100% - 75px)" }}
            >
              {itemData.desc}
            </Typography>
          )}

          <Typography
            component="span"
            title="updated time"
            style={{ fontSize: 14 }}
          >
            {parseExpire(itemData.updated)}
          </Typography>
        </Box>
      </Wrapper>

      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorPosition={position}
        anchorReference="anchorPosition"
        transitionDuration={225}
        TransitionProps={
          OS === "macos" ? { style: { transitionDuration: "225ms" } } : {}
        }
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
              sx={{ minWidth: 133 }}
            >
              {t(item.label)}
            </MenuItem>
          ))}
      </Menu>

      {editOpen && (
        <ProfileEdit
          open={editOpen}
          itemData={itemData}
          onClose={() => setEditOpen(false)}
        />
      )}

      {fileOpen && (
        <FileEditor
          uid={uid}
          open={fileOpen}
          mode={type === "merge" ? "yaml" : "javascript"}
          onClose={() => setFileOpen(false)}
        />
      )}
    </>
  );
};

function parseExpire(expire?: number) {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
}

export default ProfileMore;
