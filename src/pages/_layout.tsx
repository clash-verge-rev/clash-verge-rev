import { Notice, TailwindIndicator } from "@/components/base";
import { LayoutControl } from "@/components/layout/layout-control";
import { Sidebar } from "@/components/layout/sidebar";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useVerge } from "@/hooks/use-verge";
import { useVisibility } from "@/hooks/use-visibility";
import LoadingPage from "@/pages/loading";
import { getPortableFlag } from "@/services/cmds";
import { cn } from "@/utils";
import getSystem from "@/utils/get-system";
import { Paper, ThemeProvider } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import i18next from "i18next";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet } from "react-router-dom";
import { SWRConfig, mutate } from "swr";
const appWindow = getCurrentWebviewWindow();

export let portableFlag = false;
dayjs.extend(relativeTime);
const OS = getSystem();
let keepUIActive = false;

const Layout = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const { t } = useTranslation();
  const { theme } = useCustomTheme();
  const visible = useVisibility();

  const { verge } = useVerge();
  const { language, enable_system_title_bar, enable_keep_ui_active } = verge;
  keepUIActive = enable_keep_ui_active ?? false;

  appWindow.isMaximized().then((maximized) => {
    setIsMaximized(maximized);
  });
  const unlistenResize = appWindow.onResized(() => {
    appWindow.isMaximized().then((value) => {
      if (isMaximized !== value) {
        setIsMaximized(value);
      }
    });
  });

  const handleClose = (keepUIActive: boolean) => {
    if (keepUIActive) {
      appWindow.hide();
    } else {
      appWindow.close();
    }
  };

  useEffect(() => {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && OS !== "macos") {
        handleClose(keepUIActive);
      }
    });

    const unlistenRefreshProfiles = listen(
      "verge://refresh-profiles",
      async () => {
        mutate("getProfiles");
      },
    );

    const unlistenRefreshClash = listen(
      "verge://refresh-clash-config",
      async () => {
        // the clash info may be updated
        mutate("getProxies");
        mutate("getVersion");
        mutate("getClashConfig");
        mutate("getClashInfo");
        mutate("getRuntimeConfig");
        mutate("getProxyProviders");
      },
    );

    // update the verge config
    const unlistenRefreshVerge = listen("verge://refresh-verge-config", () => {
      mutate("getVergeConfig");
    });

    // 设置提示监听
    const unlistenNotice = listen("verge://notice-message", ({ payload }) => {
      const [status, msg] = payload as [string, string];
      switch (status) {
        case "set_config::ok":
          Notice.success(t("Clash Config Updated"));
          break;
        case "set_config::error":
          Notice.error(t(msg));
          break;
        default:
          break;
      }
    });

    setTimeout(async () => {
      portableFlag = await getPortableFlag();
      await appWindow.unminimize();
      await appWindow.show();
      await appWindow.setFocus();
    }, 50);

    return () => {
      unlistenRefreshProfiles.then((fn) => fn());
      unlistenRefreshClash.then((fn) => fn());
      unlistenRefreshVerge.then((fn) => fn());
      unlistenNotice.then((fn) => fn());
      unlistenResize.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      i18next.changeLanguage(language);
    }
  }, [language, visible]);

  return (
    <SWRConfig value={{ errorRetryCount: 3 }}>
      <ThemeProvider theme={theme}>
        <Paper
          square
          elevation={0}
          className={cn("relative flex h-screen w-screen overflow-hidden", {
            "rounded-md border-2 border-solid border-(--divider-color)":
              OS === "linux" && !enable_system_title_bar,
            "rounded-none": isMaximized,
          })}
          onContextMenu={(e) => {
            // only prevent it on Windows
            const validList = ["input", "textarea"];
            const target = e.currentTarget;
            if (
              OS === "windows" &&
              !(
                validList.includes(target.tagName.toLowerCase()) ||
                target.isContentEditable
              )
            ) {
              e.preventDefault();
            }
          }}>
          <Sidebar enableSystemTitleBar={!!enable_system_title_bar} />

          <div className="flex h-full w-full flex-col overflow-hidden">
            {!enable_system_title_bar && (
              <div className="z-10 box-border flex shrink-0 grow-0 basis-8 justify-end">
                <div
                  className="mt-1 w-full"
                  data-tauri-drag-region="true"></div>
                {OS !== "macos" && (
                  <LayoutControl
                    maximized={isMaximized}
                    onClose={() => handleClose(keepUIActive)}
                  />
                )}
              </div>
            )}

            <div className="flex-auto overflow-auto py-1 pr-1">
              <Suspense fallback={<LoadingPage />}>
                <Outlet />
              </Suspense>
            </div>

            <TailwindIndicator />
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
