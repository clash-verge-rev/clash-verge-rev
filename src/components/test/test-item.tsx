import { useEffect, useState } from "react";
import { useLockFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Divider, MenuItem, Menu, styled, alpha } from "@mui/material";
import { BaseLoading } from "@/components/base";
import { LanguageRounded } from "@mui/icons-material";
import { Notice } from "@/components/base";
import { TestBox } from "./test-box";
import delayManager from "@/services/delay";
import { cmdTestDelay, downloadIconCache } from "@/services/cmds";
import { UnlistenFn } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useListen } from "@/hooks/use-listen";
interface Props {
  id: string;
  itemData: IVergeTestItem;
  onEdit: () => void;
  onDelete: (uid: string) => void;
}

let eventListener: UnlistenFn = () => {};

export const TestItem = (props: Props) => {
  const { itemData, onEdit, onDelete: onDeleteItem } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<any>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [delay, setDelay] = useState(-1);
  const { uid, name, icon, url } = itemData;
  const [iconCachePath, setIconCachePath] = useState("");
  const { addListener } = useListen();

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

  const listenTsetEvent = async () => {
    eventListener();
    eventListener = await addListener("verge://test-all", () => {
      onDelay();
    });
  };

  useEffect(() => {
    listenTsetEvent();
  }, [url]);

  return (
    <Box
      sx={{
        position: "relative",
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? "calc(infinity)" : undefined,
      }}
    >
      <TestBox
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget);
          event.preventDefault();
        }}
      >
        <Box
          position="relative"
          sx={{ cursor: "move" }}
          ref={setNodeRef}
          {...attributes}
          {...listeners}
        >
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
              <LanguageRounded sx={{ height: "40px" }} fontSize="large" />
            </Box>
          )}

          <Box sx={{ display: "flex", justifyContent: "center" }}>{name}</Box>
        </Box>
        <Divider sx={{ marginTop: "8px" }} />
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            marginTop: "8px",
            color: "primary.main",
          }}
        >
          {delay === -2 && (
            <Widget>
              <BaseLoading />
            </Widget>
          )}

          {delay === -1 && (
            <Widget
              className="the-check"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelay();
              }}
              sx={({ palette }) => ({
                ":hover": { bgcolor: alpha(palette.primary.main, 0.15) },
              })}
            >
              {t("Test")}
            </Widget>
          )}

          {delay >= 0 && (
            // 显示延迟
            <Widget
              className="the-delay"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelay();
              }}
              color={delayManager.formatDelayColor(delay)}
              sx={({ palette }) => ({
                ":hover": {
                  bgcolor: alpha(palette.primary.main, 0.15),
                },
              })}
            >
              {delayManager.formatDelay(delay)}
            </Widget>
          )}
        </Box>
      </TestBox>

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
        {menu.map((item) => (
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
    </Box>
  );
};
const Widget = styled(Box)(({ theme: { typography } }) => ({
  padding: "3px 6px",
  fontSize: 14,
  fontFamily: typography.fontFamily,
  borderRadius: "4px",
}));
