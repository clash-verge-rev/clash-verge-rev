import { List, Paper, SvgIcon, ThemeProvider } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useRoutes } from "react-router-dom";
import { SWRConfig, mutate } from "swr";

import iconDark from "@/assets/image/icon_dark.svg?react";
import iconLight from "@/assets/image/icon_light.svg?react";
import LogoSvg from "@/assets/image/logo.svg?react";
import { NoticeManager } from "@/components/base/NoticeManager";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import { useClashInfo } from "@/hooks/use-clash";
import { useConnectionData } from "@/hooks/use-connection-data";
import { useI18n } from "@/hooks/use-i18n";
import { useListen } from "@/hooks/use-listen";
import { useLogData } from "@/hooks/use-log-data-new";
import { useMemoryData } from "@/hooks/use-memory-data";
import { useTrafficData } from "@/hooks/use-traffic-data";
import { useVerge } from "@/hooks/use-verge";
import { useWindowDecorations } from "@/hooks/use-window";
import { getAxios } from "@/services/api";
import { showNotice } from "@/services/noticeService";
import { useClashLog, useThemeMode } from "@/services/states";
import getSystem from "@/utils/get-system";

import { routers } from "./_routers";

import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";

import { WindowControls } from "@/components/controller/window-controller";
// 删除重复导入

const appWindow = getCurrentWebviewWindow();
export const portableFlag = false;

dayjs.extend(relativeTime);

const OS = getSystem();

// 通知处理函数
const handleNoticeMessage = (
  status: string,
  msg: string,
  t: (key: string) => string,
  navigate: (path: string, options?: any) => void,
) => {
  console.log("[通知监听 V2] 收到消息:", status, msg);

  switch (status) {
    case "import_sub_url::ok":
      navigate("/profile", { state: { current: msg } });
      showNotice("success", t("Import Subscription Successful"));
      break;
    case "import_sub_url::error":
      navigate("/profile");
      showNotice("error", msg);
      break;
    case "set_config::error":
      showNotice("error", msg);
      break;
    case "update_with_clash_proxy":
      showNotice(
        "success",
        `${t("Update with Clash proxy successfully")} ${msg}`,
      );
      break;
    case "update_retry_with_clash":
      showNotice("info", t("Update failed, retrying with Clash proxy..."));
      break;
    case "update_failed_even_with_clash":
      showNotice(
        "error",
        `${t("Update failed even with Clash proxy")}: ${msg}`,
      );
      break;
    case "update_failed":
      showNotice("error", msg);
      break;
    case "config_validate::boot_error":
      showNotice("error", `${t("Boot Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::core_change":
      showNotice(
        "error",
        `${t("Core Change Config Validation Failed")} ${msg}`,
      );
      break;
    case "config_validate::error":
      showNotice("error", `${t("Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::process_terminated":
      showNotice("error", t("Config Validation Process Terminated"));
      break;
    case "config_validate::stdout_error":
      showNotice("error", `${t("Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::script_error":
      showNotice("error", `${t("Script File Error")} ${msg}`);
      break;
    case "config_validate::script_syntax_error":
      showNotice("error", `${t("Script Syntax Error")} ${msg}`);
      break;
    case "config_validate::script_missing_main":
      showNotice("error", `${t("Script Missing Main")} ${msg}`);
      break;
    case "config_validate::file_not_found":
      showNotice("error", `${t("File Not Found")} ${msg}`);
      break;
    case "config_validate::yaml_syntax_error":
      showNotice("error", `${t("YAML Syntax Error")} ${msg}`);
      break;
    case "config_validate::yaml_read_error":
      showNotice("error", `${t("YAML Read Error")} ${msg}`);
      break;
    case "config_validate::yaml_mapping_error":
      showNotice("error", `${t("YAML Mapping Error")} ${msg}`);
      break;
    case "config_validate::yaml_key_error":
      showNotice("error", `${t("YAML Key Error")} ${msg}`);
      break;
    case "config_validate::yaml_error":
      showNotice("error", `${t("YAML Error")} ${msg}`);
      break;
    case "config_validate::merge_syntax_error":
      showNotice("error", `${t("Merge File Syntax Error")} ${msg}`);
      break;
    case "config_validate::merge_mapping_error":
      showNotice("error", `${t("Merge File Mapping Error")} ${msg}`);
      break;
    case "config_validate::merge_key_error":
      showNotice("error", `${t("Merge File Key Error")} ${msg}`);
      break;
    case "config_validate::merge_error":
      showNotice("error", `${t("Merge File Error")} ${msg}`);
      break;
    case "config_core::change_success":
      showNotice("success", `${t("Core Changed Successfully")}: ${msg}`);
      break;
    case "config_core::change_error":
      showNotice("error", `${t("Failed to Change Core")}: ${msg}`);
      break;
    default: // Optional: Log unhandled statuses
      console.warn(`[通知监听 V2] 未处理的状态: ${status}`);
      break;
  }
};

const Layout = () => {
  useTrafficData();
  useMemoryData();
  useConnectionData();
  useLogData();
  const mode = useThemeMode();
  const isDark = mode === "light" ? false : true;
  const { t } = useTranslation();
  const { theme } = useCustomTheme();
  const { verge } = useVerge();
  const { clashInfo } = useClashInfo();
  const [clashLog] = useClashLog();
  const enableLog = clashLog.enable;
  const logLevel = clashLog.logLevel;
  // const [logLevel] = useLocalStorage<LogLevel>("log:log-level", "info");
  const { language, start_page } = verge ?? {};
  const { switchLanguage } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const routersEles = useRoutes(routers);
  const { addListener } = useListen();
  const initRef = useRef(false);
  const [themeReady, setThemeReady] = useState(false);

  const windowControls = useRef<any>(null);
  const { decorated } = useWindowDecorations();

  const customTitlebar = useMemo(() => {
    console.debug(
      "[Layout] Titlebar rendering - decorated:",
      decorated,
      "| showing:",
      !decorated,
      "| theme mode:",
      mode,
    );
    if (!decorated) {
      return (
        <div className="the_titlebar" data-tauri-drag-region="true">
          <WindowControls ref={windowControls} />
        </div>
      );
    }
    return null;
  }, [decorated, mode]);

  useEffect(() => {
    setThemeReady(true);
  }, [theme]);

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload;
      setTimeout(() => {
        try {
          handleNoticeMessage(status, msg, t, navigate);
        } catch (error) {
          console.error("[Layout] 处理通知消息失败:", error);
        }
      }, 0);
    },
    [t, navigate],
  );

  // 初始化全局日志服务
  // useEffect(() => {
  //   if (clashInfo) {
  //     initGlobalLogService(enableLog, logLevel);
  //   }
  // }, [clashInfo, enableLog, logLevel]);

  // 设置监听器
  useEffect(() => {
    const listeners = [
      addListener("verge://refresh-clash-config", async () => {
        await getAxios(true);
        mutate("getProxies");
        mutate("getVersion");
        mutate("getClashConfig");
        mutate("getProxyProviders");
      }),

      addListener("verge://refresh-verge-config", () => {
        mutate("getVergeConfig");
        mutate("getSystemProxy");
        mutate("getAutotemProxy");
        // 运行模式变更时也需要刷新相关状态
        mutate("getRunningMode");
        mutate("isServiceAvailable");
      }),

      addListener("verge://notice-message", ({ payload }) =>
        handleNotice(payload as [string, string]),
      ),
    ];

    const setupWindowListeners = async () => {
      const [hideUnlisten, showUnlisten] = await Promise.all([
        listen("verge://hide-window", () => appWindow.hide()),
        listen("verge://show-window", () => appWindow.show()),
      ]);

      return () => {
        hideUnlisten();
        showUnlisten();
      };
    };

    const cleanupWindow = setupWindowListeners();

    return () => {
      setTimeout(() => {
        listeners.forEach((listener) => {
          if (typeof listener.then === "function") {
            listener
              .then((unlisten) => {
                try {
                  unlisten();
                } catch (error) {
                  console.error("[Layout] 清理事件监听器失败:", error);
                }
              })
              .catch((error) => {
                console.error("[Layout] 获取unlisten函数失败:", error);
              });
          }
        });

        cleanupWindow
          .then((cleanup) => {
            try {
              cleanup();
            } catch (error) {
              console.error("[Layout] 清理窗口监听器失败:", error);
            }
          })
          .catch((error) => {
            console.error("[Layout] 获取cleanup函数失败:", error);
          });
      }, 0);
    };
  }, [handleNotice]);

  useEffect(() => {
    if (initRef.current) {
      console.log("[Layout] 初始化代码已执行过，跳过");
      return;
    }
    console.log("[Layout] 开始执行初始化代码");
    initRef.current = true;

    let isInitialized = false;
    let initializationAttempts = 0;
    const maxAttempts = 3;

    const notifyBackend = async (action: string, stage?: string) => {
      try {
        if (stage) {
          console.log(`[Layout] 通知后端 ${action}: ${stage}`);
          await invoke("update_ui_stage", { stage });
        } else {
          console.log(`[Layout] 通知后端 ${action}`);
          await invoke("notify_ui_ready");
        }
      } catch (err) {
        console.error(`[Layout] 通知失败 ${action}:`, err);
      }
    };

    const removeLoadingOverlay = () => {
      const initialOverlay = document.getElementById("initial-loading-overlay");
      if (initialOverlay) {
        console.log("[Layout] 移除加载指示器");
        initialOverlay.style.opacity = "0";
        setTimeout(() => {
          try {
            initialOverlay.remove();
          } catch {
            console.log("[Layout] 加载指示器已被移除");
          }
        }, 300);
      }
    };

    const performInitialization = async () => {
      if (isInitialized) {
        console.log("[Layout] 已经初始化过，跳过");
        return;
      }

      initializationAttempts++;
      console.log(`[Layout] 开始第 ${initializationAttempts} 次初始化尝试`);

      try {
        removeLoadingOverlay();

        await notifyBackend("加载阶段", "Loading");

        await new Promise<void>((resolve) => {
          const checkReactMount = () => {
            const rootElement = document.getElementById("root");
            if (rootElement && rootElement.children.length > 0) {
              console.log("[Layout] React组件已挂载");
              resolve();
            } else {
              setTimeout(checkReactMount, 50);
            }
          };

          checkReactMount();

          setTimeout(() => {
            console.log("[Layout] React组件挂载检查超时，继续执行");
            resolve();
          }, 2000);
        });

        await notifyBackend("DOM就绪", "DomReady");

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });

        await notifyBackend("资源加载完成", "ResourcesLoaded");

        await notifyBackend("UI就绪");

        isInitialized = true;
        console.log(`[Layout] 第 ${initializationAttempts} 次初始化完成`);
      } catch (error) {
        console.error(
          `[Layout] 第 ${initializationAttempts} 次初始化失败:`,
          error,
        );

        if (initializationAttempts < maxAttempts) {
          console.log(
            `[Layout] 将在500ms后进行第 ${initializationAttempts + 1} 次重试`,
          );
          setTimeout(performInitialization, 500);
        } else {
          console.error("[Layout] 所有初始化尝试都失败，执行紧急初始化");

          removeLoadingOverlay();
          try {
            await notifyBackend("UI就绪");
            isInitialized = true;
          } catch (e) {
            console.error("[Layout] 紧急初始化也失败:", e);
          }
        }
      }
    };

    let hasEventTriggered = false;

    const setupEventListener = async () => {
      try {
        console.log("[Layout] 开始监听启动完成事件");
      } catch (err) {
        console.error("[Layout] 监听启动完成事件失败:", err);
        return () => {};
      }
    };

    const checkImmediateInitialization = async () => {
      try {
        console.log("[Layout] 检查后端是否已就绪");
        await invoke("update_ui_stage", { stage: "Loading" });

        if (!hasEventTriggered && !isInitialized) {
          console.log("[Layout] 后端已就绪，立即开始初始化");
          hasEventTriggered = true;
          performInitialization();
        }
      } catch {
        console.log("[Layout] 后端尚未就绪，等待启动完成事件");
      }
    };

    const backupInitialization = setTimeout(() => {
      if (!hasEventTriggered && !isInitialized) {
        console.warn("[Layout] 备用初始化触发：1.5秒内未开始初始化");
        hasEventTriggered = true;
        performInitialization();
      }
    }, 1500);

    const emergencyInitialization = setTimeout(() => {
      if (!isInitialized) {
        console.error("[Layout] 紧急初始化触发：5秒内未完成初始化");
        removeLoadingOverlay();
        notifyBackend("UI就绪").catch(() => {});
        isInitialized = true;
      }
    }, 5000);

    setTimeout(checkImmediateInitialization, 100);

    return () => {
      clearTimeout(backupInitialization);
      clearTimeout(emergencyInitialization);
    };
  }, []);

  // 语言和起始页设置
  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      switchLanguage(language);
    }
  }, [language, switchLanguage]);

  useEffect(() => {
    if (start_page) {
      navigate(start_page, { replace: true });
    }
  }, [start_page]);

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

  if (!routersEles) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: mode === "light" ? "#fff" : "#181a1b",
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
            // TODO: 禁止右键菜单
            // if (
            //   OS === "windows" &&
            //   !["input", "textarea"].includes(
            //     e.currentTarget.tagName.toLowerCase(),
            //   ) &&
            //   !e.currentTarget.isContentEditable
            // ) {
            //   e.preventDefault();
            // }
          }}
          sx={[
            ({ palette }) => ({ bgcolor: palette.background.paper }),
            OS === "linux"
              ? {
                  borderRadius: "8px",
                  border: "1px solid var(--divider-color)",
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

              <List className="the-menu">
                {routers.map((router) => (
                  <LayoutItem
                    key={router.label}
                    to={router.path}
                    icon={router.icon}
                  >
                    {t(router.label)}
                  </LayoutItem>
                ))}
              </List>

              <div className="the-traffic">
                <LayoutTraffic />
              </div>
            </div>

            <div className="layout-content__right">
              <div className="the-bar"></div>
              <div className="the-content">
                {React.cloneElement(routersEles, { key: location.pathname })}
              </div>
            </div>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
