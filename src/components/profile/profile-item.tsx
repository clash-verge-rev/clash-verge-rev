import { Notice, ScrollableText } from "@/components/base";
import { ProfileEditorViewer } from "@/components/profile/profile-editor-viewer";
import { openWebUrl, updateProfile, viewProfile } from "@/services/cmds";
import {
  useLoadingCache,
  useSetLoadingCache,
  useThemeMode,
} from "@/services/states";
import { cn } from "@/utils";
import parseTraffic from "@/utils/parse-traffic";
import {
  CheckCircle,
  CloudSync,
  Delete,
  Edit,
  FileOpen,
  Home,
  Refresh,
  RefreshRounded,
} from "@mui/icons-material";
import {
  Box,
  CircularProgress,
  IconButton,
  keyframes,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  SxProps,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";
import { ConfirmViewer } from "./confirm-viewer";
import { ProfileDiv } from "./profile-box";
import { LogMessage } from "./profile-more";

const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

interface Props {
  sx?: SxProps;
  selected: boolean;
  isDragging?: boolean;
  activating: boolean;
  itemData: IProfileItem;
  chainLogs: Record<string, LogMessage[]>;
  onSelect: (force: boolean) => void;
  onDelete: () => void;
  onReactivate: () => void;
}

export const ProfileItem = (props: Props) => {
  const {
    sx,
    selected,
    isDragging,
    activating,
    itemData,
    chainLogs,
    onSelect,
    onDelete,
    onReactivate,
  } = props;

  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const [anchorEl, setAnchorEl] = useState<any>(null);
  if (anchorEl && isDragging) {
    setAnchorEl(null);
  }
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const loadingCache = useLoadingCache();
  const setLoadingCache = useSetLoadingCache();

  const { uid, name = "Profile", extra, updated = 0 } = itemData;
  // remote file mode
  const hasUrl = !!itemData.url;
  const hasExtra = !!extra; // only subscription url has extra info
  const hasHome = !!itemData.home; // only subscription url has home page
  const { upload = 0, download = 0, total = 0 } = extra ?? {};
  const from = parseUrl(itemData.url);
  const description = itemData.desc;
  const expire = parseExpire(extra?.expire);
  const progress = Math.min(
    Math.round(((download + upload) * 100) / (total + 0.1)),
    100,
  );

  const loading = loadingCache[uid] || false;

  // interval update fromNow field
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

  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onOpenHome = () => {
    setAnchorEl(null);
    openWebUrl(itemData.home ?? "");
  };

  const onEdit = () => {
    setAnchorEl(null);
    setOpen(true);
  };

  const onForceSelect = async () => {
    setAnchorEl(null);
    onSelect(true);
  };

  const onOpenFile = useLockFn(async () => {
    setAnchorEl(null);
    try {
      await viewProfile(uid);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  /// 0 不使用任何代理
  /// 1 使用订阅好的代理
  /// 2 至少使用一个代理，根据订阅，如果没订阅，默认使用系统代理
  const onUpdate = useLockFn(async (type: 0 | 1 | 2) => {
    setAnchorEl(null);
    setLoadingCache((cache) => ({ ...cache, [uid]: true }));

    const option: Partial<IProfileOption> = {};

    if (type === 0) {
      option.with_proxy = false;
      option.self_proxy = false;
    } else if (type === 1) {
      // nothing
    } else if (type === 2) {
      if (itemData.option?.self_proxy) {
        option.with_proxy = false;
        option.self_proxy = true;
      } else {
        option.with_proxy = true;
        option.self_proxy = false;
      }
    }

    try {
      await updateProfile(uid, option);
      mutate("getProfiles");
    } catch (err: any) {
      const errmsg = err?.message || err.toString();
      Notice.error(
        errmsg.replace(/error sending request for url (\S+?): /, ""),
      );
    } finally {
      setLoadingCache((cache) => ({ ...cache, [uid]: false }));
    }
  });

  const menus = [
    {
      label: "Select",
      icon: <CheckCircle fontSize="small" />,
      handler: onForceSelect,
    },
    {
      label: "Edit",
      icon: <Edit fontSize="small" />,
      handler: onEdit,
    },
    {
      label: "Open File",
      icon: <FileOpen fontSize="small" />,
      handler: onOpenFile,
    },
  ];

  if (hasUrl) {
    menus.push({
      label: "Update",
      icon: <Refresh fontSize="small" />,
      handler: () => onUpdate(0),
    });
    menus.push({
      label: "Update(Proxy)",
      icon: <CloudSync fontSize="small" />,
      handler: () => onUpdate(2),
    });
    if (hasHome) {
      menus.splice(1, 0, {
        label: "Home",
        icon: <Home fontSize="small" />,
        handler: onOpenHome,
      });
    }
  }
  menus.push({
    label: "Delete",
    icon: <Delete fontSize="small" color="error" />,
    handler: () => {
      setAnchorEl(null);
      setConfirmOpen(true);
    },
  });

  const boxStyle = {
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
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
        aria-label={isDragging ? "dragging" : "profile"}
        aria-selected={selected}
        onClick={() => onSelect(false)}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}>
        {activating && (
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
        <Box position="relative">
          <div className="w-[calc(100%-36px)]">
            <ScrollableText>
              <Typography
                sx={{ fontSize: "18px", fontWeight: "600", lineHeight: "26px" }}
                variant="h6"
                component="h2"
                noWrap
                title={name}>
                {name}
              </Typography>
            </ScrollableText>
          </div>

          {/* only if has url can it be updated */}
          {hasUrl && (
            <IconButton
              title={t("Refresh")}
              sx={{
                position: "absolute",
                p: "3px",
                top: -1,
                right: -5,
                ...(loading && { animation: `1s linear infinite ${round}` }),
              }}
              size="small"
              color="inherit"
              disabled={loading}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(1);
              }}>
              <RefreshRounded color="inherit" />
            </IconButton>
          )}
        </Box>
        {/* the second line show url's info or description */}
        <Box sx={boxStyle}>
          {
            <>
              {description ? (
                <Typography
                  noWrap
                  title={description}
                  sx={{ fontSize: "14px" }}>
                  {description}
                </Typography>
              ) : (
                hasUrl && (
                  <Typography noWrap title={`${t("From")} ${from}`}>
                    {from}
                  </Typography>
                )
              )}
              {hasUrl && (
                <Typography
                  noWrap
                  flex="1 0 auto"
                  fontSize={14}
                  textAlign="right"
                  title={`${t("Updated Time")}: ${parseExpire(updated)}`}>
                  {updated > 0 ? dayjs(updated * 1000).fromNow() : ""}
                </Typography>
              )}
            </>
          }
        </Box>
        {/* the third line show extra info or last updated time */}
        {hasExtra ? (
          <Box sx={{ ...boxStyle, fontSize: 14 }}>
            <span title={t("Used / Total")}>
              {parseTraffic(upload + download)} / {parseTraffic(total)}
            </span>
            <span title={t("Expire Time")}>{expire}</span>
          </Box>
        ) : (
          <Box sx={{ ...boxStyle, fontSize: 12, justifyContent: "flex-end" }}>
            <span title={t("Updated Time")}>{parseExpire(updated)}</span>
          </Box>
        )}
        {hasExtra && <LinearProgress variant="determinate" value={progress} />}
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
        {menus.map((item) => (
          <MenuItem
            key={item.label}
            onClick={item.handler}
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
        open={open}
        profileItem={itemData}
        chainLogs={chainLogs}
        type="clash"
        language="yaml"
        onChange={() => {
          if (selected) {
            onReactivate();
          }
        }}
        onClose={() => setOpen(false)}
      />
      <ConfirmViewer
        title={t("Confirm deletion")}
        message={t("This operation is not reversible")}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setAnchorEl(null);
          setConfirmOpen(false);
          onDelete();
        }}
      />
    </Box>
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
