import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Box,
  List,
  Menu,
  MenuItem,
  Paper,
  SvgIcon,
  ThemeProvider,
} from "@mui/material";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useNavigate } from "react-router";
import { SWRConfig } from "swr";

import iconDark from "@/assets/image/icon_dark.svg?react";
import iconLight from "@/assets/image/icon_light.svg?react";
import LogoSvg from "@/assets/image/logo.svg?react";
import { BaseErrorBoundary } from "@/components/base";
import { NoticeManager } from "@/components/base/NoticeManager";
import { WindowControls } from "@/components/controller/window-controller";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useI18n } from "@/hooks/use-i18n";
import { useVerge } from "@/hooks/use-verge";
import { useWindowDecorations } from "@/hooks/use-window";
import { useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";

import {
  useAppInitialization,
  useLayoutEvents,
  useLoadingOverlay,
} from "./_layout/hooks";
import { handleNoticeMessage } from "./_layout/utils";
import { navItems } from "./_routers";

import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";

export const portableFlag = false;

type NavItem = (typeof navItems)[number];

const createNavLookup = (items: NavItem[]) => {
  const map = new Map(items.map((item) => [item.path, item]));
  const defaultOrder = items.map((item) => item.path);
  return { map, defaultOrder };
};

const resolveMenuOrder = (
  order: string[] | null | undefined,
  defaultOrder: string[],
  map: Map<string, NavItem>,
) => {
  const seen = new Set<string>();
  const resolved: string[] = [];

  if (Array.isArray(order)) {
    for (const path of order) {
      if (map.has(path) && !seen.has(path)) {
        resolved.push(path);
        seen.add(path);
      }
    }
  }

  for (const path of defaultOrder) {
    if (!seen.has(path)) {
      resolved.push(path);
      seen.add(path);
    }
  }

  return resolved;
};

const areOrdersEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

type MenuContextPosition = { top: number; left: number };
type MenuOrderAction = { type: "sync"; payload: string[] };

const menuOrderReducer = (state: string[], action: MenuOrderAction) => {
  const next = action.payload;
  if (areOrdersEqual(state, next)) {
    return state;
  }
  return [...next];
};

interface SortableNavMenuItemProps {
  item: NavItem;
  label: string;
}

const SortableNavMenuItem = ({ item, label }: SortableNavMenuItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.path,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    style.zIndex = 100;
  }

  return (
    <LayoutItem
      to={item.path}
      icon={item.icon}
      sortable={{
        setNodeRef,
        attributes,
        listeners,
        style,
        isDragging,
      }}
    >
      {label}
    </LayoutItem>
  );
};

dayjs.extend(relativeTime);

const OS = getSystem();

const Layout = () => {
  const mode = useThemeMode();
  const isDark = mode !== "light";
  const { t } = useTranslation();
  const { theme } = useCustomTheme();
  const { verge, mutateVerge, patchVerge } = useVerge();
  const { language } = verge ?? {};
  const { switchLanguage } = useI18n();
  const navigate = useNavigate();
  const themeReady = useMemo(() => Boolean(theme), [theme]);

  const [menuUnlocked, setMenuUnlocked] = useState(false);
  const [menuContextPosition, setMenuContextPosition] =
    useState<MenuContextPosition | null>(null);

  const windowControls = useRef<any>(null);
  const { decorated } = useWindowDecorations();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const { map: navItemMap, defaultOrder: defaultMenuOrder } = useMemo(
    () => createNavLookup(navItems),
    [],
  );

  const configMenuOrder = useMemo(
    () => resolveMenuOrder(verge?.menu_order, defaultMenuOrder, navItemMap),
    [verge?.menu_order, defaultMenuOrder, navItemMap],
  );

  const [menuOrder, dispatchMenuOrder] = useReducer(
    menuOrderReducer,
    configMenuOrder,
  );

  useEffect(() => {
    dispatchMenuOrder({ type: "sync", payload: configMenuOrder });
  }, [configMenuOrder]);

  const handleMenuDragEnd = useCallback(
    async (event: DragEndEvent) => {
      if (!menuUnlocked) {
        return;
      }

      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      const activeId = String(active.id);
      const overId = String(over.id);

      const oldIndex = menuOrder.indexOf(activeId);
      const newIndex = menuOrder.indexOf(overId);

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      const previousOrder = [...menuOrder];
      const nextOrder = arrayMove(menuOrder, oldIndex, newIndex);

      dispatchMenuOrder({ type: "sync", payload: nextOrder });
      mutateVerge(
        (prev) => (prev ? { ...prev, menu_order: nextOrder } : prev),
        false,
      );

      try {
        await patchVerge({ menu_order: nextOrder });
      } catch (error) {
        console.error("Failed to update menu order:", error);
        dispatchMenuOrder({ type: "sync", payload: previousOrder });
        mutateVerge(
          (prev) => (prev ? { ...prev, menu_order: previousOrder } : prev),
          false,
        );
      }
    },
    [menuUnlocked, menuOrder, mutateVerge, patchVerge],
  );

  const handleMenuContextMenu = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setMenuContextPosition({ top: event.clientY, left: event.clientX });
    },
    [],
  );

  const handleMenuContextClose = useCallback(() => {
    setMenuContextPosition(null);
  }, []);

  const handleUnlockMenu = useCallback(() => {
    setMenuUnlocked(true);
    setMenuContextPosition(null);
  }, []);

  const handleLockMenu = useCallback(() => {
    setMenuUnlocked(false);
    setMenuContextPosition(null);
  }, []);

  const customTitlebar = useMemo(
    () =>
      !decorated ? (
        <div className="the_titlebar" data-tauri-drag-region="true">
          <WindowControls ref={windowControls} />
        </div>
      ) : null,
    [decorated],
  );

  useLoadingOverlay(themeReady);
  useAppInitialization();

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload;
      try {
        handleNoticeMessage(status, msg, t, navigate);
      } catch (error) {
        console.error("[通知处理] 失败:", error);
      }
    },
    [t, navigate],
  );

  useLayoutEvents(handleNotice);

  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      switchLanguage(language);
    }
  }, [language, switchLanguage]);

  if (!themeReady) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: mode === "light" ? "#fff" : "#181a1b",
          transition: "background 0.2s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: mode === "light" ? "#333" : "#fff",
        }}
      ></div>
    );
  }

  return (
    <SWRConfig
      value={{
        errorRetryCount: 3,
        errorRetryInterval: 5000,
        onError: (error, key) => {
          console.error(`[SWR Error] Key: ${key}, Error:`, error);
          if (key !== "getAutotemProxy") {
            console.error(`SWR Error for ${key}:`, error);
          }
        },
        dedupingInterval: 2000,
      }}
    >
      <ThemeProvider theme={theme}>
        {/* 左侧底部窗口控制按钮 */}
        <NoticeManager />
        <div
          style={{
            animation: "fadeIn 0.5s",
            WebkitAnimation: "fadeIn 0.5s",
          }}
        />
        <style>
          {`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}
        </style>
        <Paper
          square
          elevation={0}
          className={`${OS} layout`}
          style={{
            borderTopLeftRadius: "0px",
            borderTopRightRadius: "0px",
          }}
          onContextMenu={(e) => {
            if (
              OS === "windows" &&
              !["input", "textarea"].includes(
                e.currentTarget.tagName.toLowerCase(),
              ) &&
              !e.currentTarget.isContentEditable
            ) {
              e.preventDefault();
            }
          }}
          sx={[
            ({ palette }) => ({ bgcolor: palette.background.paper }),
            OS === "linux"
              ? {
                  borderRadius: "8px",
                  width: "100vw",
                  height: "100vh",
                }
              : {},
          ]}
        >
          {/* Custom titlebar - rendered only when decorated is false, memoized for performance */}
          {customTitlebar}

          <div className="layout-content">
            <div className="layout-content__left">
              <div className="the-logo" data-tauri-drag-region="false">
                <div
                  data-tauri-drag-region="true"
                  style={{
                    height: "27px",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <SvgIcon
                    component={isDark ? iconDark : iconLight}
                    style={{
                      height: "36px",
                      width: "36px",
                      marginTop: "-3px",
                      marginRight: "5px",
                      marginLeft: "-3px",
                    }}
                    inheritViewBox
                  />
                  <LogoSvg fill={isDark ? "white" : "black"} />
                </div>
                <UpdateButton className="the-newbtn" />
              </div>

              {menuUnlocked && (
                <Box
                  sx={(theme) => ({
                    px: 1.5,
                    py: 0.75,
                    mx: "auto",
                    mb: 1,
                    maxWidth: 250,
                    borderRadius: 1.5,
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: "center",
                    color: theme.palette.warning.contrastText,
                    bgcolor:
                      theme.palette.mode === "light"
                        ? theme.palette.warning.main
                        : theme.palette.warning.dark,
                  })}
                >
                  {t("layout.components.navigation.menu.reorderMode")}
                </Box>
              )}

              {menuUnlocked ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleMenuDragEnd}
                >
                  <SortableContext items={menuOrder}>
                    <List
                      className="the-menu"
                      onContextMenu={handleMenuContextMenu}
                    >
                      {menuOrder.map((path) => {
                        const item = navItemMap.get(path);
                        if (!item) {
                          return null;
                        }
                        return (
                          <SortableNavMenuItem
                            key={item.path}
                            item={item}
                            label={t(item.label)}
                          />
                        );
                      })}
                    </List>
                  </SortableContext>
                </DndContext>
              ) : (
                <List
                  className="the-menu"
                  onContextMenu={handleMenuContextMenu}
                >
                  {menuOrder.map((path) => {
                    const item = navItemMap.get(path);
                    if (!item) {
                      return null;
                    }
                    return (
                      <LayoutItem
                        key={item.path}
                        to={item.path}
                        icon={item.icon}
                      >
                        {t(item.label)}
                      </LayoutItem>
                    );
                  })}
                </List>
              )}

              <Menu
                open={Boolean(menuContextPosition)}
                onClose={handleMenuContextClose}
                anchorReference="anchorPosition"
                anchorPosition={
                  menuContextPosition
                    ? {
                        top: menuContextPosition.top,
                        left: menuContextPosition.left,
                      }
                    : undefined
                }
                transitionDuration={200}
                slotProps={{
                  list: {
                    sx: { py: 0.5 },
                  },
                }}
              >
                <MenuItem
                  onClick={menuUnlocked ? handleLockMenu : handleUnlockMenu}
                  dense
                >
                  {menuUnlocked
                    ? t("layout.components.navigation.menu.lock")
                    : t("layout.components.navigation.menu.unlock")}
                </MenuItem>
              </Menu>

              <div className="the-traffic">
                <LayoutTraffic />
              </div>
            </div>

            <div className="layout-content__right">
              <div className="the-bar"></div>
              <div className="the-content">
                <BaseErrorBoundary>
                  <Outlet />
                </BaseErrorBoundary>
              </div>
            </div>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
