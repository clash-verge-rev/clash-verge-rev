import { FeaturedPlayListRounded } from "@mui/icons-material";
import {
  Box,
  Badge,
  Chip,
  Typography,
  MenuItem,
  Menu,
  IconButton,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { EditorViewer } from "@/components/profile/editor-viewer";
import { viewProfile, readProfileFile, saveProfileFile } from "@/services/cmds";
import { showNotice } from "@/services/notice-service";

import { LogViewer } from "./log-viewer";
import { ProfileBox } from "./profile-box";

interface Props {
  logInfo?: [string, string][];
  id: "Merge" | "Script";
  onSave?: (prev?: string, curr?: string) => void;
}

const EMPTY_LOG_INFO: [string, string][] = [];

// profile enhanced item
export const ProfileMore = (props: Props) => {
  const { id, logInfo, onSave } = props;

  const entries = logInfo ?? EMPTY_LOG_INFO;
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [fileOpen, setFileOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const onEditFile = () => {
    setAnchorEl(null);
    setFileOpen(true);
  };

  const onOpenFile = useLockFn(async () => {
    setAnchorEl(null);
    try {
      await viewProfile(id);
    } catch (err) {
      showNotice.error(err);
    }
  });

  const hasError = entries.some(([level]) => level === "exception");

  const globalTitles: Record<Props["id"], string> = {
    Merge: "profiles.components.more.global.merge",
    Script: "profiles.components.more.global.script",
  };

  const chipLabels: Record<Props["id"], string> = {
    Merge: "profiles.components.more.chips.merge",
    Script: "profiles.components.more.chips.script",
  };

  const itemMenu = [
    { label: "profiles.components.menu.editFile", handler: onEditFile },
    { label: "profiles.components.menu.openFile", handler: onOpenFile },
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
        onDoubleClick={onEditFile}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget as HTMLElement);
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
            title={t(globalTitles[id])}
          >
            {t(globalTitles[id])}
          </Typography>

          <Chip
            label={t(chipLabels[id])}
            color="primary"
            size="small"
            variant="outlined"
            sx={{ height: 20, textTransform: "capitalize" }}
          />
        </Box>

        <Box sx={boxStyle}>
          {id === "Script" &&
            (hasError ? (
              <Badge color="error" variant="dot" overlap="circular">
                <IconButton
                  size="small"
                  edge="start"
                  color="error"
                  title={t("profiles.modals.logViewer.title")}
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
                title={t("profiles.modals.logViewer.title")}
                onClick={() => setLogOpen(true)}
              >
                <FeaturedPlayListRounded fontSize="inherit" />
              </IconButton>
            ))}
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
        {itemMenu
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
      {fileOpen && (
        <EditorViewer
          open={true}
          title={t(globalTitles[id])}
          initialData={() => readProfileFile(id)}
          dataKey={id}
          language={id === "Merge" ? "yaml" : "javascript"}
          onSave={async (prev, curr) => {
            await saveProfileFile(id, curr ?? "");
            onSave?.(prev, curr);
          }}
          onClose={() => setFileOpen(false)}
        />
      )}
      {logOpen && (
        <LogViewer
          open={logOpen}
          logInfo={entries}
          onClose={() => setLogOpen(false)}
        />
      )}
    </>
  );
};
