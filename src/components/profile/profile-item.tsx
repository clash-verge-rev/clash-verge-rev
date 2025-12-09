import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  RefreshRounded,
  DragIndicatorRounded,
  CheckBoxRounded,
  CheckBoxOutlineBlankRounded,
} from "@mui/icons-material";
import {
  Box,
  Typography,
  LinearProgress,
  IconButton,
  keyframes,
  MenuItem,
  Menu,
  CircularProgress,
} from "@mui/material";
import { open } from "@tauri-apps/plugin-shell";
import { useLockFn } from "ahooks";
import dayjs from "dayjs";
import { useEffect, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { mutate } from "swr";

import { ConfirmViewer } from "@/components/profile/confirm-viewer";
import { EditorViewer } from "@/components/profile/editor-viewer";
import { GroupsEditorViewer } from "@/components/profile/groups-editor-viewer";
import { RulesEditorViewer } from "@/components/profile/rules-editor-viewer";
import {
  viewProfile,
  readProfileFile,
  updateProfile,
  saveProfileFile,
  getNextUpdateTime,
} from "@/services/cmds";
import { showNotice } from "@/services/notice-service";
import { useLoadingCache, useSetLoadingCache } from "@/services/states";
import type { TranslationKey } from "@/types/generated/i18n-keys";
import { debugLog } from "@/utils/debug";
import parseTraffic from "@/utils/parse-traffic";

import { ProfileBox } from "./profile-box";
import { ProxiesEditorViewer } from "./proxies-editor-viewer";
const round = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

interface Props {
  id: string;
  selected: boolean;
  activating: boolean;
  itemData: IProfileItem;
  onSelect: (force: boolean) => void;
  onEdit: () => void;
  onSave?: (prev?: string, curr?: string) => void;
  onDelete: () => void;
  batchMode?: boolean;
  isSelected?: boolean;
  onSelectionChange?: () => void;
}

export const ProfileItem = (props: Props) => {
  const {
    id,
    selected,
    activating,
    itemData,
    onSelect,
    onEdit,
    onSave,
    onDelete,
    batchMode,
    isSelected,
    onSelectionChange,
  } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  });

  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const loadingCache = useLoadingCache();
  const setLoadingCache = useSetLoadingCache();

  // 新增状态：是否显示下次更新时间
  const [showNextUpdate, setShowNextUpdate] = useState(false);
  const [nextUpdateTime, setNextUpdateTime] = useState("");

  const { uid, name = "Profile", extra, updated = 0, option } = itemData;

  // 获取下次更新时间的函数
  const fetchNextUpdateTime = useLockFn(async (forceRefresh = false) => {
    if (
      itemData.option?.update_interval &&
      itemData.option.update_interval > 0
    ) {
      try {
        debugLog(`尝试获取配置 ${itemData.uid} 的下次更新时间`);

        // 如果需要强制刷新，先触发Timer.refresh()
        if (forceRefresh) {
          // 这里可以通过一个新的API来触发刷新，但目前我们依赖patch_profile中的刷新
          debugLog(`强制刷新定时器任务`);
        }

        const nextUpdate = await getNextUpdateTime(itemData.uid);
        debugLog(`获取到下次更新时间结果:`, nextUpdate);

        if (nextUpdate) {
          const nextUpdateDate = dayjs(nextUpdate * 1000);
          const now = dayjs();

          // 如果已经过期，显示"更新失败"
          if (nextUpdateDate.isBefore(now)) {
            setNextUpdateTime(
              t("profiles.components.profileItem.status.lastUpdateFailed"),
            );
          } else {
            // 否则显示剩余时间
            const diffMinutes = nextUpdateDate.diff(now, "minute");

            if (diffMinutes < 60) {
              if (diffMinutes <= 0) {
                setNextUpdateTime(
                  `${t("profiles.components.profileItem.status.nextUp")} <1m`,
                );
              } else {
                setNextUpdateTime(
                  `${t("profiles.components.profileItem.status.nextUp")} ${diffMinutes}m`,
                );
              }
            } else {
              const hours = Math.floor(diffMinutes / 60);
              const mins = diffMinutes % 60;
              setNextUpdateTime(
                `${t("profiles.components.profileItem.status.nextUp")} ${hours}h ${mins}m`,
              );
            }
          }
        } else {
          debugLog(`返回的下次更新时间为空`);
          setNextUpdateTime(
            t("profiles.components.profileItem.status.noSchedule"),
          );
        }
      } catch (err) {
        console.error(`获取下次更新时间出错:`, err);
        setNextUpdateTime(t("profiles.components.profileItem.status.unknown"));
      }
    } else {
      debugLog(`该配置未设置更新间隔或间隔为0`);
      setNextUpdateTime(
        t("profiles.components.profileItem.status.autoUpdateDisabled"),
      );
    }
  });

  // 切换显示模式的函数
  const toggleUpdateTimeDisplay = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!showNextUpdate) {
      fetchNextUpdateTime();
    }

    setShowNextUpdate(!showNextUpdate);
  };

  // 当组件加载或更新间隔变化时更新下次更新时间
  useEffect(() => {
    if (showNextUpdate) {
      fetchNextUpdateTime();
    }
  }, [
    fetchNextUpdateTime,
    showNextUpdate,
    itemData.option?.update_interval,
    updated,
  ]);

  // 订阅定时器更新事件
  useEffect(() => {
    let refreshTimeout: number | undefined;
    // 处理定时器更新事件 - 这个事件专门用于通知定时器变更
    const handleTimerUpdate = (event: Event) => {
      const source = event as CustomEvent<string> & { payload?: string };
      const updatedUid = source.detail ?? source.payload;

      // 只有当更新的是当前配置时才刷新显示
      if (updatedUid === itemData.uid && showNextUpdate) {
        debugLog(`收到定时器更新事件: uid=${updatedUid}`);
        if (refreshTimeout !== undefined) {
          clearTimeout(refreshTimeout);
        }
        refreshTimeout = window.setTimeout(() => {
          fetchNextUpdateTime(true);
        }, 1000);
      }
    };

    // 只注册定时器更新事件监听
    window.addEventListener("verge://timer-updated", handleTimerUpdate);

    return () => {
      if (refreshTimeout !== undefined) {
        clearTimeout(refreshTimeout);
      }
      // 清理事件监听
      window.removeEventListener("verge://timer-updated", handleTimerUpdate);
    };
  }, [fetchNextUpdateTime, itemData.uid, showNextUpdate]);

  // local file mode
  // remote file mode
  // remote file mode
  const hasUrl = !!itemData.url;
  const hasExtra = !!extra; // only subscription url has extra info
  const hasHome = !!itemData.home; // only subscription url has home page

  const { upload = 0, download = 0, total = 0 } = extra ?? {};
  const from = parseUrl(itemData.url);
  const description = itemData.desc;
  const expire = parseExpire(extra?.expire);
  const progress = Math.min(
    Math.round(((download + upload) * 100) / (total + 0.01)) + 1,
    100,
  );

  const loading = loadingCache[itemData.uid] ?? false;

  // interval update fromNow field
  const [, forceRefresh] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (!hasUrl) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const handler = () => {
      const now = Date.now();
      const lastUpdate = updated * 1000;
      // 大于一天的不管
      if (now - lastUpdate >= 24 * 36e5) return;

      const wait = now - lastUpdate >= 36e5 ? 30e5 : 5e4;

      timer = setTimeout(() => {
        forceRefresh();
        handler();
      }, wait);
    };

    handler();

    return () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
  }, [forceRefresh, hasUrl, updated]);

  const [fileOpen, setFileOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [proxiesOpen, setProxiesOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onOpenHome = () => {
    setAnchorEl(null);
    open(itemData.home ?? "");
  };

  const onEditInfo = () => {
    setAnchorEl(null);
    onEdit();
  };

  const onEditFile = () => {
    setAnchorEl(null);
    setFileOpen(true);
  };

  const onEditRules = () => {
    setAnchorEl(null);
    setRulesOpen(true);
  };

  const onEditProxies = () => {
    setAnchorEl(null);
    setProxiesOpen(true);
  };

  const onEditGroups = () => {
    setAnchorEl(null);
    setGroupsOpen(true);
  };

  const onEditMerge = () => {
    setAnchorEl(null);
    setMergeOpen(true);
  };

  const onEditScript = () => {
    setAnchorEl(null);
    setScriptOpen(true);
  };

  const onForceSelect = () => {
    setAnchorEl(null);
    onSelect(true);
  };

  const onOpenFile = useLockFn(async () => {
    setAnchorEl(null);
    try {
      await viewProfile(itemData.uid);
    } catch (err) {
      showNotice.error(err);
    }
  });

  /// 0 不使用任何代理
  /// 1 使用订阅好的代理
  /// 2 至少使用一个代理，根据订阅，如果没订阅，默认使用系统代理
  const onUpdate = useLockFn(async (type: 0 | 1 | 2): Promise<void> => {
    setAnchorEl(null);
    setLoadingCache((cache) => ({ ...cache, [itemData.uid]: true }));

    // 根据类型设置初始更新选项
    const option: Partial<IProfileOption> = {};
    if (type === 0) {
      option.with_proxy = false;
      option.self_proxy = false;
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
      // 调用后端更新（后端会自动处理回退逻辑）
      const payload = Object.keys(option).length > 0 ? option : undefined;
      await updateProfile(itemData.uid, payload);

      // 更新成功，刷新列表
      mutate("getProfiles");
    } catch {
      // 更新完全失败（包括后端的回退尝试）
      // 不需要做处理，后端会通过事件通知系统发送错误
    } finally {
      setLoadingCache((cache) => ({ ...cache, [itemData.uid]: false }));
    }
  });

  type ContextMenuItem = {
    label: string;
    handler: () => void;
    disabled: boolean;
  };

  const menuLabels: Record<string, TranslationKey> = {
    home: "profiles.components.menu.home",
    select: "profiles.components.menu.select",
    editInfo: "profiles.components.menu.editInfo",
    editFile: "profiles.components.menu.editFile",
    editRules: "profiles.components.menu.editRules",
    editProxies: "profiles.components.menu.editProxies",
    editGroups: "profiles.components.menu.editGroups",
    extendConfig: "profiles.components.menu.extendConfig",
    extendScript: "profiles.components.menu.extendScript",
    openFile: "profiles.components.menu.openFile",
    update: "profiles.components.menu.update",
    updateViaProxy: "profiles.components.menu.updateViaProxy",
    delete: "shared.actions.delete",
  } as const;

  const urlModeMenu: ContextMenuItem[] = [
    ...(hasHome
      ? [
          {
            label: menuLabels.home,
            handler: onOpenHome,
            disabled: false,
          } satisfies ContextMenuItem,
        ]
      : []),
    {
      label: menuLabels.select,
      handler: onForceSelect,
      disabled: false,
    },
    {
      label: menuLabels.editInfo,
      handler: onEditInfo,
      disabled: false,
    },
    {
      label: menuLabels.editFile,
      handler: onEditFile,
      disabled: false,
    },
    {
      label: menuLabels.editRules,
      handler: onEditRules,
      disabled: !option?.rules,
    },
    {
      label: menuLabels.editProxies,
      handler: onEditProxies,
      disabled: !option?.proxies,
    },
    {
      label: menuLabels.editGroups,
      handler: onEditGroups,
      disabled: !option?.groups,
    },
    {
      label: menuLabels.extendConfig,
      handler: onEditMerge,
      disabled: !option?.merge,
    },
    {
      label: menuLabels.extendScript,
      handler: onEditScript,
      disabled: !option?.script,
    },
    {
      label: menuLabels.openFile,
      handler: onOpenFile,
      disabled: false,
    },
    {
      label: menuLabels.update,
      handler: () => onUpdate(0),
      disabled: false,
    },
    {
      label: menuLabels.updateViaProxy,
      handler: () => onUpdate(2),
      disabled: false,
    },
    {
      label: menuLabels.delete,
      handler: () => {
        setAnchorEl(null);
        if (batchMode) {
          // If in batch mode, just toggle selection instead of showing delete confirmation
          if (onSelectionChange) {
            onSelectionChange();
          }
        } else {
          setConfirmOpen(true);
        }
      },
      disabled: false,
    },
  ];
  const fileModeMenu: ContextMenuItem[] = [
    {
      label: menuLabels.select,
      handler: onForceSelect,
      disabled: false,
    },
    {
      label: menuLabels.editInfo,
      handler: onEditInfo,
      disabled: false,
    },
    {
      label: menuLabels.editFile,
      handler: onEditFile,
      disabled: false,
    },
    {
      label: menuLabels.editRules,
      handler: onEditRules,
      disabled: !option?.rules,
    },
    {
      label: menuLabels.editProxies,
      handler: onEditProxies,
      disabled: !option?.proxies,
    },
    {
      label: menuLabels.editGroups,
      handler: onEditGroups,
      disabled: !option?.groups,
    },
    {
      label: menuLabels.extendConfig,
      handler: onEditMerge,
      disabled: !option?.merge,
    },
    {
      label: menuLabels.extendScript,
      handler: onEditScript,
      disabled: !option?.script,
    },
    {
      label: menuLabels.openFile,
      handler: onOpenFile,
      disabled: false,
    },
    {
      label: menuLabels.delete,
      handler: () => {
        setAnchorEl(null);
        if (batchMode) {
          // If in batch mode, just toggle selection instead of showing delete confirmation
          if (onSelectionChange) {
            onSelectionChange();
          }
        } else {
          setConfirmOpen(true);
        }
      },
      disabled: false,
    },
  ];

  const boxStyle = {
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  // 监听自动更新事件
  useEffect(() => {
    const handleUpdateStarted = (event: Event) => {
      const customEvent = event as CustomEvent<{ uid?: string }>;
      if (customEvent.detail?.uid === itemData.uid) {
        setLoadingCache((cache) => ({ ...cache, [itemData.uid]: true }));
      }
    };

    const handleUpdateCompleted = (event: Event) => {
      const customEvent = event as CustomEvent<{ uid?: string }>;
      if (customEvent.detail?.uid === itemData.uid) {
        setLoadingCache((cache) => ({ ...cache, [itemData.uid]: false }));
        // 更新完成后刷新显示
        if (showNextUpdate) {
          fetchNextUpdateTime();
        }
      }
    };

    // 注册事件监听
    window.addEventListener("profile-update-started", handleUpdateStarted);
    window.addEventListener("profile-update-completed", handleUpdateCompleted);

    return () => {
      // 清理事件监听
      window.removeEventListener("profile-update-started", handleUpdateStarted);
      window.removeEventListener(
        "profile-update-completed",
        handleUpdateCompleted,
      );
    };
  }, [fetchNextUpdateTime, itemData.uid, setLoadingCache, showNextUpdate]);

  return (
    <Box
      sx={{
        position: "relative",
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? "calc(infinity)" : undefined,
      }}
    >
      <ProfileBox
        aria-selected={selected}
        onClick={(e) => {
          // 如果正在激活中，阻止重复点击
          if (activating) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          onSelect(false);
        }}
        onContextMenu={(event) => {
          const { clientX, clientY } = event;
          setPosition({ top: clientY, left: clientX });
          setAnchorEl(event.currentTarget as HTMLElement);
          event.preventDefault();
        }}
      >
        {activating && (
          <Box
            sx={{
              position: "absolute",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              top: 10,
              left: 10,
              right: 10,
              bottom: 2,
              zIndex: 10,
              backdropFilter: "blur(2px)",
              backgroundColor: "rgba(0, 0, 0, 0.1)",
            }}
          >
            <CircularProgress
              color="inherit"
              size={20}
              sx={{
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          </Box>
        )}
        <Box position="relative">
          <Box sx={{ display: "flex", justifyContent: "start" }}>
            {batchMode && (
              <IconButton
                size="small"
                sx={{ padding: "2px", marginRight: "4px", marginLeft: "-8px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelectionChange) {
                    onSelectionChange();
                  }
                }}
              >
                {isSelected ? (
                  <CheckBoxRounded color="primary" />
                ) : (
                  <CheckBoxOutlineBlankRounded />
                )}
              </IconButton>
            )}
            <Box
              ref={setNodeRef}
              sx={{
                display: "flex",
                margin: "auto 0",
                ...(batchMode && { marginLeft: "-4px" }),
              }}
              {...attributes}
              {...listeners}
            >
              <DragIndicatorRounded
                sx={[
                  { cursor: "move", marginLeft: "-6px" },
                  ({ palette: { text } }) => {
                    return { color: text.primary };
                  },
                ]}
              />
            </Box>

            <Typography
              width={batchMode ? "calc(100% - 56px)" : "calc(100% - 36px)"}
              sx={{ fontSize: "18px", fontWeight: "600", lineHeight: "26px" }}
              variant="h6"
              component="h2"
              noWrap
              title={name}
            >
              {name}
            </Typography>
          </Box>

          {/* only if has url can it be updated */}
          {hasUrl && (
            <IconButton
              title={t("shared.actions.refresh")}
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
                // 如果正在激活或加载中，阻止更新操作
                if (activating || loading) {
                  return;
                }
                onUpdate(1);
              }}
            >
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
                  sx={{ fontSize: "14px" }}
                >
                  {description}
                </Typography>
              ) : (
                hasUrl && (
                  <Typography
                    noWrap
                    title={`${t("shared.labels.from")} ${from}`}
                  >
                    {from}
                  </Typography>
                )
              )}
              {hasUrl && (
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "flex-end",
                    ml: "auto",
                  }}
                >
                  <Typography
                    noWrap
                    component="span"
                    fontSize={14}
                    textAlign="right"
                    title={
                      showNextUpdate
                        ? t("profiles.components.profileItem.tooltips.showLast")
                        : `${t("shared.labels.updateTime")}: ${parseExpire(updated)}\n${t("profiles.components.profileItem.tooltips.showNext")}`
                    }
                    sx={{
                      cursor: "pointer",
                      display: "inline-block",
                      borderBottom: "1px dashed transparent",
                      transition: "all 0.2s",
                      "&:hover": {
                        borderBottomColor: "primary.main",
                        color: "primary.main",
                      },
                    }}
                    onClick={toggleUpdateTimeDisplay}
                  >
                    {showNextUpdate
                      ? nextUpdateTime
                      : updated > 0
                        ? dayjs(updated * 1000).fromNow()
                        : ""}
                  </Typography>
                </Box>
              )}
            </>
          }
        </Box>
        {/* the third line show extra info or last updated time */}
        {hasExtra ? (
          <Box sx={{ ...boxStyle, fontSize: 14 }}>
            <span title={t("shared.labels.usedTotal")}>
              {parseTraffic(upload + download)} / {parseTraffic(total)}
            </span>
            <span title={t("shared.labels.expireTime")}>{expire}</span>
          </Box>
        ) : (
          <Box sx={{ ...boxStyle, fontSize: 12, justifyContent: "flex-end" }}>
            <span title={t("shared.labels.updateTime")}>
              {parseExpire(updated)}
            </span>
          </Box>
        )}
        <LinearProgress
          variant="determinate"
          value={progress}
          style={{ opacity: total > 0 ? 1 : 0 }}
        />
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
        {(hasUrl ? urlModeMenu : fileModeMenu).map((item) => (
          <MenuItem
            key={item.label}
            onClick={item.handler}
            disabled={item.disabled}
            sx={[
              {
                minWidth: 120,
              },
              (theme) => {
                return {
                  color:
                    item.label === menuLabels.delete
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
          initialData={() => readProfileFile(uid)}
          dataKey={uid}
          language="yaml"
          onSave={async (prev, curr) => {
            await saveProfileFile(uid, curr ?? "");
            onSave?.(prev, curr);
          }}
          onClose={() => setFileOpen(false)}
        />
      )}
      {rulesOpen && (
        <RulesEditorViewer
          groupsUid={option?.groups ?? ""}
          mergeUid={option?.merge ?? ""}
          profileUid={uid}
          property={option?.rules ?? ""}
          open={true}
          onSave={onSave}
          onClose={() => setRulesOpen(false)}
        />
      )}
      {proxiesOpen && (
        <ProxiesEditorViewer
          profileUid={uid}
          property={option?.proxies ?? ""}
          open={true}
          onSave={onSave}
          onClose={() => setProxiesOpen(false)}
        />
      )}
      {groupsOpen && (
        <GroupsEditorViewer
          mergeUid={option?.merge ?? ""}
          proxiesUid={option?.proxies ?? ""}
          profileUid={uid}
          property={option?.groups ?? ""}
          open={true}
          onSave={onSave}
          onClose={() => {
            setGroupsOpen(false);
          }}
        />
      )}
      {mergeOpen && (
        <EditorViewer
          open={true}
          initialData={() => readProfileFile(option?.merge ?? "")}
          dataKey={`merge:${option?.merge ?? ""}`}
          language="yaml"
          onSave={async (prev, curr) => {
            await saveProfileFile(option?.merge ?? "", curr ?? "");
            onSave?.(prev, curr);
          }}
          onClose={() => setMergeOpen(false)}
        />
      )}
      {scriptOpen && (
        <EditorViewer
          open={true}
          initialData={() => readProfileFile(option?.script ?? "")}
          dataKey={`script:${option?.script ?? ""}`}
          language="javascript"
          onSave={async (prev, curr) => {
            await saveProfileFile(option?.script ?? "", curr ?? "");
            onSave?.(prev, curr);
          }}
          onClose={() => setScriptOpen(false)}
        />
      )}

      <ConfirmViewer
        title={t("profiles.modals.confirmDelete.title")}
        message={t("profiles.modals.confirmDelete.message")}
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          onDelete();
          setConfirmOpen(false);
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
