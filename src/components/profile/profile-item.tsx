import dayjs from "dayjs";
import { mutate } from "swr";
import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useRecoilState } from "recoil";
import { useTranslation } from "react-i18next";
import {
  Box,
  Typography,
  LinearProgress,
  IconButton,
  keyframes,
  MenuItem,
  Menu,
} from "@mui/material";
import { RefreshRounded } from "@mui/icons-material";
import { atomLoadingCache } from "@/services/states";
import { updateProfile, deleteProfile, viewProfile } from "@/services/cmds";
import parseTraffic from "@/utils/parse-traffic";
import ProfileBox from "./profile-box";
import InfoEditor from "./info-editor";
import FileEditor from "./file-editor";
import Notice from "../base/base-notice";

const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

interface Props {
  selected: boolean;
  itemData: CmdType.ProfileItem;
  onSelect: (force: boolean) => void;
}

const ProfileItem = (props: Props) => {
  const { selected, itemData, onSelect } = props;

  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [loadingCache, setLoadingCache] = useRecoilState(atomLoadingCache);

  const { uid, name = "Profile", extra, updated = 0 } = itemData;

  // local file mode
  // remote file mode
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

  const boxStyle = {
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  return (
    <>
      <ProfileBox
        aria-selected={selected}
        onClick={() => onSelect(false)}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}
      >
        <Box position="relative">
          <Typography
            width="calc(100% - 36px)"
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
                position: "absolute",
                p: "3px",
                top: -1,
                right: -5,
                animation: loading ? `1s linear infinite ${round}` : "none",
              }}
              size="small"
              color="inherit"
              disabled={loading}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(false);
              }}
            >
              <RefreshRounded color="inherit" />
            </IconButton>
          )}
        </Box>

        {/* the second line show url's info or description */}
        <Box sx={boxStyle}>
          {hasUrl ? (
            <>
              <Typography noWrap title={`From: ${from}`}>
                {from}
              </Typography>

              <Typography
                noWrap
                flex="1 0 auto"
                fontSize={14}
                textAlign="right"
                title={`Updated Time: ${parseExpire(updated)}`}
              >
                {updated > 0 ? dayjs(updated * 1000).fromNow() : ""}
              </Typography>
            </>
          ) : (
            <Typography noWrap title={itemData.desc}>
              {itemData.desc}
            </Typography>
          )}
        </Box>

        {/* the third line show extra info or last updated time */}
        {hasExtra ? (
          <Box sx={{ ...boxStyle, fontSize: 14 }}>
            <span title="Used / Total">
              {parseTraffic(upload + download)} / {parseTraffic(total)}
            </span>
            <span title="Expire Time">{expire}</span>
          </Box>
        ) : (
          <Box sx={{ ...boxStyle, fontSize: 14, justifyContent: "flex-end" }}>
            <span title="Updated Time">{parseExpire(updated)}</span>
          </Box>
        )}

        <LinearProgress
          variant="determinate"
          value={progress}
          color="inherit"
        />
      </ProfileBox>

      <Menu
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorPosition={position}
        anchorReference="anchorPosition"
        transitionDuration={225}
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

      <InfoEditor
        open={editOpen}
        itemData={itemData}
        onClose={() => setEditOpen(false)}
      />

      <FileEditor
        uid={uid}
        open={fileOpen}
        mode="yaml"
        onClose={() => setFileOpen(false)}
      />
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
