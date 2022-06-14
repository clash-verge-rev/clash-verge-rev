import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useSWRConfig } from "swr";
import { useRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
import {
  alpha,
  Box,
  styled,
  Typography,
  LinearProgress,
  IconButton,
  keyframes,
  MenuItem,
  Menu,
} from "@mui/material";
import { RefreshRounded } from "@mui/icons-material";
import { CmdType } from "../../services/types";
import { atomLoadingCache } from "../../services/states";
import { updateProfile, deleteProfile, viewProfile } from "../../services/cmds";
import parseTraffic from "../../utils/parse-traffic";
import getSystem from "../../utils/get-system";
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

const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const OS = getSystem();

interface Props {
  selected: boolean;
  itemData: CmdType.ProfileItem;
  onSelect: (force: boolean) => void;
}

const ProfileItem = (props: Props) => {
  const { selected, itemData, onSelect } = props;

  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [loadingCache, setLoadingCache] = useRecoilState(atomLoadingCache);

  const { uid, name = "Profile", extra, updated = 0 } = itemData;

  // local file mode
  // remote file mode
  // subscription url mode
  const hasUrl = !!itemData.url;
  const hasExtra = !!extra; // only subscription url has extra info

  const { upload = 0, download = 0, total = 0 } = extra ?? {};
  const from = parseUrl(itemData.url);
  const expire = parseExpire(extra?.expire);
  const progress = Math.round(((download + upload) * 100) / (total + 0.1));

  const loading = loadingCache[itemData.uid] ?? false;

  // interval update from now field
  const [, setRefresh] = useState({});
  useEffect(() => {
    if (!hasUrl) return;

    let timer: any = null;

    const handler = () => {
      const now = Date.now();
      const lastUpdate = updated * 1000;

      // 大于一天的不管
      if (now - lastUpdate >= 24 * 36e5) return;

      const wait = now - lastUpdate >= 36e5 ? 30e5 : 5e4;

      timer = setTimeout(() => {
        setRefresh({});
        handler();
      }, wait);
    };

    handler();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [hasUrl, updated]);

  const [editOpen, setEditOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);

  const onEditInfo = () => {
    setAnchorEl(null);
    setEditOpen(true);
  };

  const onEditFile = () => {
    setAnchorEl(null);
    setFileOpen(true);
  };

  const onForceSelect = () => {
    setAnchorEl(null);
    onSelect(true);
  };

  const onOpenFile = useLockFn(async () => {
    setAnchorEl(null);
    try {
      await viewProfile(itemData.uid);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const onUpdate = useLockFn(async (withProxy: boolean) => {
    setAnchorEl(null);
    setLoadingCache((cache) => ({ ...cache, [itemData.uid]: true }));

    try {
      await updateProfile(itemData.uid, { with_proxy: withProxy });
      mutate("getProfiles");
    } catch (err: any) {
      const errmsg = err?.message || err.toString();
      Notice.error(
        errmsg.replace(/error sending request for url (\S+?): /, "")
      );
    } finally {
      setLoadingCache((cache) => ({ ...cache, [itemData.uid]: false }));
    }
  });

  const onDelete = useLockFn(async () => {
    setAnchorEl(null);
    try {
      await deleteProfile(itemData.uid);
      mutate("getProfiles");
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const boxStyle = {
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const urlModeMenu = [
    { label: "Select", handler: onForceSelect },
    { label: "Edit Info", handler: onEditInfo },
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
    { label: "Update", handler: () => onUpdate(false) },
    { label: "Update(Proxy)", handler: () => onUpdate(true) },
    { label: "Delete", handler: onDelete },
  ];
  const fileModeMenu = [
    { label: "Select", handler: onForceSelect },
    { label: "Edit Info", handler: onEditInfo },
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
    { label: "Delete", handler: onDelete },
  ];

  return (
    <>
      <Wrapper
        sx={({ palette }) => {
          const { mode, primary, text, grey } = palette;
          const key = `${mode}-${selected}`;

          const bgcolor = {
            "light-true": alpha(primary.main, 0.15),
            "light-false": palette.background.paper,
            "dark-true": alpha(primary.main, 0.35),
            "dark-false": alpha(grey[700], 0.35),
          }[key]!;

          const color = {
            "light-true": text.secondary,
            "light-false": text.secondary,
            "dark-true": alpha(text.secondary, 0.75),
            "dark-false": alpha(text.secondary, 0.75),
          }[key]!;

          const h2color = {
            "light-true": primary.main,
            "light-false": text.primary,
            "dark-true": primary.light,
            "dark-false": text.primary,
          }[key]!;

          return { bgcolor, color, "& h2": { color: h2color } };
        }}
        onClick={() => onSelect(false)}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}
      >
        <Box display="flex" justifyContent="space-between">
          <Typography
            width="calc(100% - 40px)"
            variant="h6"
            component="h2"
            noWrap
            title={name}
          >
            {name}
          </Typography>

          {/* only if has url can it be updated */}
          {hasUrl && (
            <IconButton
              sx={{
                width: 26,
                height: 26,
                animation: loading ? `1s linear infinite ${round}` : "none",
              }}
              color="inherit"
              disabled={loading}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(false);
              }}
            >
              <RefreshRounded />
            </IconButton>
          )}
        </Box>

        {/* the second line show url's info or description */}
        {hasUrl ? (
          <Box sx={boxStyle}>
            <Typography noWrap title={`From: ${from}`}>
              {from}
            </Typography>

            <Typography
              noWrap
              flex="1 0 auto"
              fontSize={14}
              textAlign="right"
              title="updated time"
            >
              {updated > 0 ? dayjs(updated * 1000).fromNow() : ""}
            </Typography>
          </Box>
        ) : (
          <Box sx={boxStyle}>
            <Typography noWrap title={itemData.desc}>
              {itemData.desc}
            </Typography>
          </Box>
        )}

        {/* the third line show extra info or last updated time */}
        {hasExtra ? (
          <Box sx={{ ...boxStyle, fontSize: 14 }}>
            <span title="used / total">
              {parseTraffic(upload + download)} / {parseTraffic(total)}
            </span>
            <span title="expire time">{expire}</span>
          </Box>
        ) : (
          <Box sx={{ ...boxStyle, fontSize: 14, justifyContent: "flex-end" }}>
            <span title="updated time">{parseExpire(updated)}</span>
          </Box>
        )}

        <LinearProgress
          variant="determinate"
          value={progress}
          color="inherit"
        />
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
        {(hasUrl ? urlModeMenu : fileModeMenu).map((item) => (
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
          mode="yaml"
          onClose={() => setFileOpen(false)}
        />
      )}
    </>
  );
};

function parseUrl(url?: string) {
  if (!url) return "";
  const regex = /https?:\/\/(.+?)\//;
  const result = url.match(regex);
  return result ? result[1] : "local file";
}

function parseExpire(expire?: number) {
  if (!expire) return "-";
  return dayjs(expire * 1000).format("YYYY-MM-DD");
}

export default ProfileItem;
