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
import { viewProfile, readProfileFile, saveProfileFile } from "@/services/cmds";
import { Notice } from "@/components/base";
import { EditorViewer } from "@/components/profile/editor-viewer";
import { ProfileBox } from "./profile-box";
import { LogViewer } from "./log-viewer";

interface Props {
  logInfo?: [string, string][];
  id: "Merge" | "Script";
  onSave?: (prev?: string, curr?: string) => void;
}

// profile enhanced item
export const ProfileMore = (props: Props) => {
  const { id, logInfo = [], onSave } = props;

  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<any>(null);
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
    } catch (err: any) {
      Notice.error(err?.message || err.toString());
    }
  });

  const fnWrapper = (fn: () => void) => () => {
    setAnchorEl(null);
    return fn();
  };

  const hasError = !!logInfo.find((e) => e[0] === "exception");

  const itemMenu = [
    { label: "Edit File", handler: onEditFile },
    { label: "Open File", handler: onOpenFile },
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
            title={t(`Global ${id}`)}
          >
            {t(`Global ${id}`)}
          </Typography>

          <Chip
            label={id}
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
          title={`${t("Global " + id)}`}
          initialData={readProfileFile(id)}
          language={id === "Merge" ? "yaml" : "javascript"}
          schema={id === "Merge" ? "clash" : undefined}
          onSave={async (prev, curr) => {
            await saveProfileFile(id, curr ?? "");
            onSave && onSave(prev, curr);
          }}
          onClose={() => setFileOpen(false)}
        />
      )}
      {logOpen && (
        <LogViewer
          open={logOpen}
          logInfo={logInfo}
          onClose={() => setLogOpen(false)}
        />
      )}
    </>
  );
};
