import { BaseLoading, Notice } from "@/components/base";
import { cmdTestDelay, downloadIconCache } from "@/services/cmds";
import delayManager from "@/services/delay";
import { LanguageTwoTone } from "@mui/icons-material";
import {
  Box,
  Divider,
  Menu,
  MenuItem,
  SxProps,
  Typography,
  alpha,
  styled,
} from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useLockFn } from "ahooks";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TestDiv } from "./test-box";

interface Props {
  id: string;
  isDragging?: boolean;
  sx?: SxProps;
  itemData: IVergeTestItem;
  onEdit: () => void;
  onDelete: (uid: string) => void;
}

export const TestItem = (props: Props) => {
  const { isDragging, sx, itemData, onEdit, onDelete: onDeleteItem } = props;

  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<any>(null);
  if (anchorEl && isDragging) {
    setAnchorEl(null);
  }
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [delay, setDelay] = useState(-1);
  const { uid, name, icon, url } = itemData;
  const [iconCachePath, setIconCachePath] = useState("");

  useEffect(() => {
    initIconCachePath();
  }, [icon]);

  async function initIconCachePath() {
    if (icon && icon.trim().startsWith("http")) {
      const fileName = uid + "-" + getFileName(icon);
      const iconPath = await downloadIconCache(icon, fileName);
      setIconCachePath(convertFileSrc(iconPath));
    }
  }

  function getFileName(url: string) {
    return url.substring(url.lastIndexOf("/") + 1);
  }

  const onDelay = async () => {
    setDelay(-2);
    const result = await cmdTestDelay(url);
    setDelay(result);
  };

  const onEditTest = () => {
    setAnchorEl(null);
    onEdit();
  };

  const onDelete = useLockFn(async () => {
    setAnchorEl(null);
    try {
      onDeleteItem(uid);
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const menu = [
    { label: "Edit", handler: onEditTest },
    { label: "Delete", handler: onDelete },
  ];

  useEffect(() => {
    const unlisten = listen("verge://test-all", () => {
      onDelay();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <Box sx={{ width: "100%" }}>
      <TestDiv
        aria-label={isDragging ? "dragging" : "test"}
        sx={{ ...sx }}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}>
        <Box position="relative" sx={{ cursor: "move" }}>
          {icon && icon.trim() !== "" ? (
            <Box sx={{ display: "flex", justifyContent: "center" }}>
              {icon.trim().startsWith("http") && (
                <img
                  src={iconCachePath === "" ? icon : iconCachePath}
                  height="40px"
                />
              )}
              {icon.trim().startsWith("data") && (
                <img src={icon} height="40px" />
              )}
              {icon.trim().startsWith("<svg") && (
                <img
                  src={`data:image/svg+xml;base64,${btoa(icon)}`}
                  height="40px"
                />
              )}
            </Box>
          ) : (
            <Box sx={{ display: "flex", justifyContent: "center" }}>
              <LanguageTwoTone sx={{ height: "40px" }} fontSize="large" />
            </Box>
          )}

          <Box sx={{ display: "flex", justifyContent: "center" }}>
            <Typography variant="h6" component="h2" noWrap title={name}>
              {name}
            </Typography>
          </Box>
        </Box>
        <Divider sx={{ marginTop: "8px" }} />
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            marginTop: "8px",
            color: "primary.main",
            height: "25px",
          }}>
          {delay === -2 && (
            <Widget>
              <BaseLoading />
            </Widget>
          )}

          {delay === -1 && (
            <Widget
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelay();
              }}
              sx={({ palette }) => ({
                ":hover": { bgcolor: alpha(palette.primary.main, 0.15) },
              })}>
              {t("Test")}
            </Widget>
          )}

          {delay >= 0 && (
            // 显示延迟
            <Widget
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelay();
              }}
              sx={({ palette }) => ({
                color: delayManager.formatDelayColor(delay),
                ":hover": {
                  bgcolor: alpha(palette.primary.main, 0.15),
                },
              })}>
              {delayManager.formatDelay(delay)}
            </Widget>
          )}
        </Box>
      </TestDiv>

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
        {menu.map((item) => (
          <MenuItem
            key={item.label}
            onClick={item.handler}
            sx={{ minWidth: 120 }}
            dense>
            {t(item.label)}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};
const Widget = styled("div")(({ theme: { typography } }) => ({
  padding: "3px 6px",
  fontSize: 14,
  fontFamily: typography.fontFamily,
  borderRadius: "4px",
}));
