import { DeleteRounded, EditRounded, FolderRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useLockFn } from "ahooks";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  addProfileGroup,
  removeProfileGroup,
  renameProfileGroup,
} from "@/services/cmds";
import { showNotice } from "@/services/noticeService";

const EMPTY_GROUPS: IProfileGroup[] = [];

export interface ProfileGroupsManagerRef {
  open: () => void;
  close: () => void;
}

interface Props {
  groups?: IProfileGroup[];
  onUpdate: () => void;
}

export const ProfileGroupsManager = forwardRef<ProfileGroupsManagerRef, Props>(
  (props, ref) => {
    const { groups = EMPTY_GROUPS, onUpdate } = props;
    const { t } = useTranslation();

    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [groupName, setGroupName] = useState("");
    const [newGroupName, setNewGroupName] = useState("");

    useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: () => setOpen(false),
    }));

    const handleAddGroup = useLockFn(async () => {
      if (!newGroupName.trim()) {
        showNotice("error", t("Group name cannot be empty"));
        return;
      }

      try {
        await addProfileGroup(newGroupName.trim());
        setNewGroupName("");
        onUpdate();
        showNotice("success", t("Group added successfully"));
      } catch (err: any) {
        showNotice("error", err.message || err.toString());
      }
    });

    const handleRenameGroup = useLockFn(async (id: string) => {
      if (!groupName.trim()) {
        showNotice("error", t("Group name cannot be empty"));
        return;
      }

      try {
        await renameProfileGroup(id, groupName.trim());
        setEditing(null);
        setGroupName("");
        onUpdate();
        showNotice("success", t("Group renamed successfully"));
      } catch (err: any) {
        showNotice("error", err.message || err.toString());
      }
    });

    const handleDeleteGroup = useLockFn(async (id: string) => {
      try {
        await removeProfileGroup(id);
        onUpdate();
        showNotice("success", t("Group deleted successfully"));
      } catch (err: any) {
        showNotice("error", err.message || err.toString());
      }
    });

    return (
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("Manage Groups")}</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <TextField
                size="small"
                fullWidth
                placeholder={t("New group name")}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleAddGroup();
                  }
                }}
              />
              <Button
                variant="contained"
                sx={{
                  borderRadius: "6px",
                  minWidth: "64px",
                  flexShrink: 0,
                  height: "40px",
                }}
                onClick={handleAddGroup}
              >
                {t("Add")}
              </Button>
            </Box>

            <List sx={{ pt: 1 }}>
              {groups.map((group) => (
                <ListItem
                  key={group.id}
                  sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: 1,
                    mb: 1,
                  }}
                  secondaryAction={
                    group.id !== "default" && (
                      <Box>
                        {editing === group.id ? (
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleRenameGroup(group.id)}
                          >
                            <EditRounded />
                          </IconButton>
                        ) : (
                          <>
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => {
                                setEditing(group.id);
                                setGroupName(group.name);
                              }}
                            >
                              <EditRounded />
                            </IconButton>
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => handleDeleteGroup(group.id)}
                            >
                              <DeleteRounded />
                            </IconButton>
                          </>
                        )}
                      </Box>
                    )
                  }
                >
                  <FolderRounded sx={{ mr: 2, color: "primary.main" }} />
                  {editing === group.id ? (
                    <TextField
                      size="small"
                      fullWidth
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleRenameGroup(group.id);
                        }
                        if (e.key === "Escape") {
                          setEditing(null);
                          setGroupName("");
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <ListItemText
                      primary={group.name}
                      secondary={
                        group.id === "default" ? (
                          <Typography variant="caption" color="text.secondary">
                            {t("Default group (cannot be deleted)")}
                          </Typography>
                        ) : null
                      }
                    />
                  )}
                </ListItem>
              ))}
            </List>
          </Stack>
        </DialogContent>
      </Dialog>
    );
  },
);
