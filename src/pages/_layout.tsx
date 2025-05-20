import dayjs from "dayjs";
import i18next from "i18next";
import relativeTime from "dayjs/plugin/relativeTime";
import { SWRConfig, mutate } from "swr";
import { useEffect, useCallback, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useRoutes, useNavigate } from "react-router-dom";
import { List, Paper, ThemeProvider, SvgIcon } from "@mui/material";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { routers } from "./_routers";
import { getAxios } from "@/services/api";
import { useVerge } from "@/hooks/use-verge";
import LogoSvg from "@/assets/image/logo.svg?react";
import iconLight from "@/assets/image/icon_light.svg?react";
import iconDark from "@/assets/image/icon_dark.svg?react";
import { useThemeMode, useEnableLog } from "@/services/states";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import getSystem from "@/utils/get-system";
import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";
import { getPortableFlag } from "@/services/cmds";
import React from "react";
import { useListen } from "@/hooks/use-listen";
import { listen } from "@tauri-apps/api/event";
import { useClashInfo } from "@/hooks/use-clash";
import { initGlobalLogService } from "@/services/global-log-service";
import { invoke } from "@tauri-apps/api/core";
import { showNotice } from "@/services/noticeService";
import { NoticeManager } from "@/components/base/NoticeManager";

const appWindow = getCurrentWebviewWindow();
export let portableFlag = false;

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
      showNotice('success', t("Import Subscription Successful"));
      break;
    case "import_sub_url::error":
      navigate("/profile");
      showNotice('error', msg);
      break;
    case "set_config::error":
      showNotice('error', msg);
      break;
    case "update_with_clash_proxy":
      showNotice('success', `${t("Update with Clash proxy successfully")} ${msg}`);
      break;
    case "update_retry_with_clash":
      showNotice('info', t("Update failed, retrying with Clash proxy..."));
      break;
    case "update_failed_even_with_clash":
      showNotice('error', `${t("Update failed even with Clash proxy")}: ${msg}`);
      break;
    case "update_failed":
      showNotice('error', msg);
      break;
    case "config_validate::boot_error":
      showNotice('error', `${t("Boot Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::core_change":
      showNotice('error', `${t("Core Change Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::error":
      showNotice('error', `${t("Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::process_terminated":
      showNotice('error', t("Config Validation Process Terminated"));
      break;
    case "config_validate::stdout_error":
      showNotice('error', `${t("Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::script_error":
      showNotice('error', `${t("Script File Error")} ${msg}`);
      break;
    case "config_validate::script_syntax_error":
      showNotice('error', `${t("Script Syntax Error")} ${msg}`);
      break;
    case "config_validate::script_missing_main":
      showNotice('error', `${t("Script Missing Main")} ${msg}`);
      break;
    case "config_validate::file_not_found":
      showNotice('error', `${t("File Not Found")} ${msg}`);
      break;
    case "config_validate::yaml_syntax_error":
      showNotice('error', `${t("YAML Syntax Error")} ${msg}`);
      break;
    case "config_validate::yaml_read_error":
      showNotice('error', `${t("YAML Read Error")} ${msg}`);
      break;
    case "config_validate::yaml_mapping_error":
      showNotice('error', `${t("YAML Mapping Error")} ${msg}`);
      break;
    case "config_validate::yaml_key_error":
      showNotice('error', `${t("YAML Key Error")} ${msg}`);
      break;
    case "config_validate::yaml_error":
      showNotice('error', `${t("YAML Error")} ${msg}`);
      break;
    case "config_validate::merge_syntax_error":
      showNotice('error', `${t("Merge File Syntax Error")} ${msg}`);
      break;
    case "config_validate::merge_mapping_error":
      showNotice('error', `${t("Merge File Mapping Error")} ${msg}`);
      break;
    case "config_validate::merge_key_error":
      showNotice('error', `${t("Merge File Key Error")} ${msg}`);
      break;
    case "config_validate::merge_error":
      showNotice('error', `${t("Merge File Error")} ${msg}`);
      break;
    case "config_core::change_success":
      showNotice('success', `${t("Core Changed Successfully")}: ${msg}`);
      break;
    case "config_core::change_error":
      showNotice('error', `${t("Failed to Change Core")}: ${msg}`);
      break;
    default: // Optional: Log unhandled statuses
        console.warn(`[通知监听 V2] 未处理的状态: ${status}`);
        break;
  }
};

const Layout = () => {
  const mode = useThemeMode();
  const isDark = mode === "light" ? false : true;
  const { t } = useTranslation();
  const { theme } = useCustomTheme();
  const { verge } = useVerge();
  const { clashInfo } = useClashInfo();
  const [enableLog] = useEnableLog();
  const { language, start_page } = verge ?? {};
  const navigate = useNavigate();
  const location = useLocation();
  const routersEles = useRoutes(routers);
  const { addListener, setupCloseListener } = useListen();
  const initRef = useRef(false);

  const handleNotice = useCallback(
    (payload: [string, string]) => {
      const [status, msg] = payload;
      handleNoticeMessage(status, msg, t, navigate);
    },
    [t, navigate],
  );

  // 初始化全局日志服务
  useEffect(() => {
    if (clashInfo) {
      const { server = "", secret = "" } = clashInfo;
      initGlobalLogService(server, secret, enableLog, "info");
    }
  }, [clashInfo, enableLog]);

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

    setupCloseListener();
    const cleanupWindow = setupWindowListeners();

    return () => {
      listeners.forEach((listener) => {
        if (typeof listener.then === "function") {
          listener.then((unlisten) => unlisten());
        }
      });
      cleanupWindow.then((cleanup) => cleanup());
    };
  }, [handleNotice]);

  useEffect(() => {
    if (initRef.current) {
      console.log("[Layout] 初始化代码已执行过，跳过");
      return;
    }
    console.log("[Layout] 开始执行初始化代码");
    initRef.current = true;

    const notifyUiStage = async (stage: string) => {
      try {
        console.log(`[Layout] UI加载阶段: ${stage}`);
        await invoke("update_ui_stage", { stage });
      } catch (err) {
        console.error(`[Layout] 通知UI加载阶段(${stage})失败:`, err);
      }
    };

    const notifyUiCoreReady = async () => {
      try {
        console.log("[Layout] 核心组件已加载，通知后端");
        await invoke("update_ui_stage", { stage: "DomReady" });
      } catch (err) {
        console.error("[Layout] 通知核心组件加载完成失败:", err);
      }
    };

    const notifyUiResourcesLoaded = async () => {
      try {
        console.log("[Layout] 所有资源已加载，通知后端");
        await invoke("update_ui_stage", { stage: "ResourcesLoaded" });
      } catch (err) {
        console.error("[Layout] 通知资源加载完成失败:", err);
      }
    };

    const notifyUiReady = async () => {
      try {
        console.log("[Layout] UI完全准备就绪，通知后端");
        await invoke("notify_ui_ready");
      } catch (err) {
        console.error("[Layout] 通知UI准备就绪失败:", err);
      }
    };

    // 监听后端发送的启动完成事件
    const listenStartupCompleted = async () => {
      try {
        console.log("[Layout] 开始监听启动完成事件");
        const unlisten = await listen("verge://startup-completed", () => {
          console.log("[Layout] 收到启动完成事件，开始通知UI就绪");
          notifyUiReady();
        });
        return unlisten;
      } catch (err) {
        console.error("[Layout] 监听启动完成事件失败:", err);
        return () => {};
      }
    };

    // 初始阶段 - 开始加载
    notifyUiStage("Loading");

    setTimeout(() => {
      notifyUiCoreReady();

      setTimeout(() => {
        notifyUiResourcesLoaded();
        setTimeout(() => {
          notifyUiReady();
        }, 100);
      }, 100);
    }, 100);
    
    // 启动监听器
    const unlistenPromise = listenStartupCompleted();

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, []);

  // 语言和起始页设置
  useEffect(() => {
    if (language) {
      dayjs.locale(language === "zh" ? "zh-cn" : language);
      i18next.changeLanguage(language);
    }
  }, [language]);

  useEffect(() => {
    if (start_page) {
      navigate(start_page, { replace: true });
    }
  }, [start_page]);

  if (!routersEles) return null;

  return (
    <SWRConfig value={{ errorRetryCount: 3 }}>
      <ThemeProvider theme={theme}>
        <NoticeManager />

        <Paper
          square
          elevation={0}
          className={`${OS} layout`}
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
                  border: "1px solid var(--divider-color)",
                  width: "calc(100vw - 4px)",
                  height: "calc(100vh - 4px)",
                }
              : {},
          ]}
        >
          <div className="layout__left">
            <div className="the-logo" data-tauri-drag-region="true">
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

          <div className="layout__right">
            <div className="the-bar">
            </div>

            <div className="the-content">
              {React.cloneElement(routersEles, { key: location.pathname })}
            </div>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
