import "./style.scss";

import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const cn = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type TrayMenuItem =
  | {
      kind: "standard";
      uid: string;
      id: string;
      label: string;
      enabled: boolean;
      shortcut?: string | null;
    }
  | {
      kind: "check";
      uid: string;
      id: string;
      label: string;
      enabled: boolean;
      checked: boolean;
      shortcut?: string | null;
    }
  | {
      kind: "separator";
      uid: string;
    }
  | {
      kind: "submenu";
      uid: string;
      id: string;
      label: string;
      enabled: boolean;
      items: TrayMenuItem[];
    };

type TrayMenuPayload = {
  items: TrayMenuItem[];
  position?: {
    x: number;
    y: number;
  };
};

const appWindow = getCurrentWebviewWindow();

const TrayMenuApp: React.FC = () => {
  const [items, setItems] = useState<TrayMenuItem[]>([]);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listeners: Array<() => void> = [];

    const register = <T extends () => void>(promise: Promise<T>) => {
      promise
        .then((unlisten) => {
          listeners.push(unlisten);
        })
        .catch((error) =>
          console.error("[TrayMenu] Failed to register event listener:", error),
        );
    };

    register(
      listen<TrayMenuPayload>("tray-menu://update", async ({ payload }) => {
        setItems(payload.items ?? []);
        setVisible(true);
        try {
          await appWindow.show();
          await appWindow.setFocus();
        } catch (error) {
          console.error("[TrayMenu] Failed to show tray window:", error);
        }
      }),
    );

    register(
      listen("tray-menu://hide", async () => {
        setVisible(false);
        setItems([]);
        try {
          await appWindow.hide();
        } catch (error) {
          console.error("[TrayMenu] Failed to hide tray window:", error);
        }
      }),
    );

    return () => {
      listeners.forEach((unlisten) => {
        try {
          unlisten();
        } catch (error) {
          console.error("[TrayMenu] Failed to unregister listener:", error);
        }
      });
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    const handlePointerDown = (event: MouseEvent) => {
      const root = containerRef.current;
      if (!root || root.contains(event.target as Node)) {
        return;
      }
      invoke("hide_tray_menu").catch((error) =>
        console.error("[TrayMenu] Failed to hide tray menu:", error),
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        invoke("hide_tray_menu").catch((error) =>
          console.error("[TrayMenu] Failed to hide tray menu:", error),
        );
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("contextmenu", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    const frame = requestAnimationFrame(async () => {
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const width = Math.ceil(bounds.width) + 8;
      const height = Math.ceil(bounds.height) + 8;

      try {
        await appWindow.setSize(new LogicalSize(width, height));
      } catch (error) {
        console.error("[TrayMenu] Failed to resize tray window:", error);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [items, visible]);

  const handleItemClick = useCallback(
    async (item: Extract<TrayMenuItem, { id: string }>) => {
      if (!item.enabled) return;

      try {
        await invoke("trigger_tray_menu_action", { id: item.id });
      } catch (error) {
        console.error("[TrayMenu] Failed to run menu command:", error);
      }
    },
    [],
  );

  const renderNodes = useCallback(
    (nodes: TrayMenuItem[], depth = 0): React.ReactNode =>
      nodes.map((item) => {
        switch (item.kind) {
          case "separator":
            return (
              <div
                key={item.uid}
                className={cn(
                  "tray-menu__separator",
                  depth > 0 && "tray-menu__separator--nested",
                )}
              />
            );
          case "submenu":
            return (
              <div
                key={item.uid}
                className={cn(
                  "tray-menu__submenu",
                  depth > 0 && "tray-menu__submenu--nested",
                )}
              >
                <div className="tray-menu__submenu-label">{item.label}</div>
                <div className="tray-menu__submenu-items">
                  {renderNodes(item.items, depth + 1)}
                </div>
              </div>
            );
          default:
            return (
              <MenuButton
                key={item.uid}
                item={item}
                depth={depth}
                onActivate={handleItemClick}
              />
            );
        }
      }),
    [handleItemClick],
  );

  return (
    <div
      ref={containerRef}
      className={cn("tray-menu", !visible && "tray-menu--hidden")}
    >
      <div className="tray-menu__list">{renderNodes(items)}</div>
    </div>
  );
};

type MenuButtonProps = {
  item: Exclude<TrayMenuItem, { kind: "separator" | "submenu" }>;
  depth?: number;
  onActivate: (item: Extract<TrayMenuItem, { id: string }>) => void;
};

const MenuButton: React.FC<MenuButtonProps> = ({
  item,
  depth = 0,
  onActivate,
}) => {
  const isCheckable = item.kind === "check";
  const enabled = item.enabled !== false;

  const handleClick = () => {
    if (!enabled) return;
    onActivate(item);
  };

  return (
    <button
      type="button"
      className={cn(
        "tray-menu__item",
        !enabled && "tray-menu__item--disabled",
        isCheckable && item.checked && "tray-menu__item--checked",
      )}
      onClick={handleClick}
      disabled={!enabled}
      style={{ paddingLeft: 12 + depth * 16 }}
    >
      <span className="tray-menu__item-prefix">
        {isCheckable && item.checked ? "\u2713" : ""}
      </span>
      <span className="tray-menu__item-label">{item.label}</span>
      {item.shortcut ? (
        <span className="tray-menu__item-shortcut">{item.shortcut}</span>
      ) : null}
    </button>
  );
};

export { TrayMenuApp };

const container = document.getElementById("root");

if (!container) {
  throw new Error("Tray menu root element not found");
}

appWindow
  .hide()
  .catch((error) =>
    console.error("[TrayMenu] Failed to hide window during init:", error),
  );

createRoot(container).render(<TrayMenuApp />);
