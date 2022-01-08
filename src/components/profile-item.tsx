import React, { useState } from "react";
import dayjs from "dayjs";
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
import { useSWRConfig } from "swr";
import { RefreshRounded } from "@mui/icons-material";
import { CmdType } from "../services/types";
import { updateProfile, deleteProfile } from "../services/cmds";
import parseTraffic from "../utils/parse-traffic";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

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

interface Props {
  index: number;
  selected: boolean;
  itemData: CmdType.ProfileItem;
  onClick: () => void;
}

const ProfileItemComp: React.FC<Props> = (props) => {
  const { index, selected, itemData, onClick } = props;

  const { mutate } = useSWRConfig();
  const [loading, setLoading] = useState(false);
  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const { name = "Profile", extra, updated = 0 } = itemData;
  const { upload = 0, download = 0, total = 0 } = extra ?? {};
  const from = parseUrl(itemData.url);
  const expire = parseExpire(extra?.expire);
  const progress = Math.round(((download + upload) * 100) / (total + 0.1));
  const fromnow = updated > 0 ? dayjs(updated * 1000).fromNow() : "";

  const onUpdate = async () => {
    setAnchorEl(null);
    if (loading) return;
    setLoading(true);
    try {
      await updateProfile(index);
      mutate("getProfiles");
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async () => {
    setAnchorEl(null);
    try {
      await deleteProfile(index);
      mutate("getProfiles");
    } catch (err) {
      console.error(err);
    }
  };

  const handleContextMenu = (
    event: React.MouseEvent<HTMLDivElement, MouseEvent>
  ) => {
    const { clientX, clientY } = event;
    setPosition({ top: clientY, left: clientX });
    setAnchorEl(event.currentTarget);
    event.preventDefault();
  };

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
        onClick={onClick}
        onContextMenu={handleContextMenu}
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

          <IconButton
            sx={{
              width: 30,
              height: 30,
              animation: loading ? `1s linear infinite ${round}` : "none",
            }}
            color="inherit"
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              onUpdate();
            }}
          >
            <RefreshRounded />
          </IconButton>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center">
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
            {fromnow}
          </Typography>
        </Box>

        <Box
          sx={{
            my: 0.5,
            fontSize: 14,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span title="used / total">
            {parseTraffic(upload + download)} / {parseTraffic(total)}
          </span>
          <span title="expire time">{expire}</span>
        </Box>

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
      >
        <MenuItem onClick={onUpdate}>Update</MenuItem>
        <MenuItem onClick={onDelete}>Delete</MenuItem>
        {/* <MenuItem>Update(proxy)</MenuItem> */}
      </Menu>
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

export default ProfileItemComp;
