import dayjs from "dayjs";
import i18next from "i18next";
import relativeTime from "dayjs/plugin/relativeTime";
import { SWRConfig, mutate } from "swr";
import { useEffect, useCallback } from "react";
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
import { Notice } from "@/components/base";
import { LayoutItem } from "@/components/layout/layout-item";
import { LayoutControl } from "@/components/layout/layout-control";
import { LayoutTraffic } from "@/components/layout/layout-traffic";
import { UpdateButton } from "@/components/layout/update-button";
import { useCustomTheme } from "@/components/layout/use-custom-theme";
import getSystem from "@/utils/get-system";
import "dayjs/locale/ru";
import "dayjs/locale/zh-cn";
import { getPortableFlag } from "@/services/cmds";
import React from "react";
import { TransitionGroup, CSSTransition } from "react-transition-group";
import { useListen } from "@/hooks/use-listen";
import { listen } from "@tauri-apps/api/event";
import { useClashInfo } from "@/hooks/use-clash";
import { initGlobalLogService } from "@/services/global-log-service";

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
  console.log("[通知监听] 收到消息:", status, msg);

  switch (status) {
    case "import_sub_url::ok":
      navigate("/profile", { state: { current: msg } });
      Notice.success(t("Import Subscription Successful"));
      break;
    case "import_sub_url::error":
      navigate("/profile");
      Notice.error(msg);
      break;
    case "set_config::error":
      Notice.error(msg);
      break;
    case "config_validate::boot_error":
      Notice.error(`${t("Boot Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::core_change":
      Notice.error(`${t("Core Change Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::error":
      Notice.error(`${t("Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::process_terminated":
      Notice.error(t("Config Validation Process Terminated"));
      break;
    case "config_validate::stdout_error":
      Notice.error(`${t("Config Validation Failed")} ${msg}`);
      break;
    case "config_validate::script_error":
      Notice.error(`${t("Script File Error")} ${msg}`);
      break;
    case "config_validate::script_syntax_error":
      Notice.error(`${t("Script Syntax Error")} ${msg}`);
      break;
    case "config_validate::script_missing_main":
      Notice.error(`${t("Script Missing Main")} ${msg}`);
      break;
    case "config_validate::file_not_found":
      Notice.error(`${t("File Not Found")} ${msg}`);
      break;
    case "config_validate::yaml_syntax_error":
      Notice.error(`${t("YAML Syntax Error")} ${msg}`);
      break;
    case "config_validate::yaml_read_error":
      Notice.error(`${t("YAML Read Error")} ${msg}`);
      break;
    case "config_validate::yaml_mapping_error":
      Notice.error(`${t("YAML Mapping Error")} ${msg}`);
      break;
    case "config_validate::yaml_key_error":
      Notice.error(`${t("YAML Key Error")} ${msg}`);
      break;
    case "config_validate::yaml_error":
      Notice.error(`${t("YAML Error")} ${msg}`);
      break;
    case "config_validate::merge_syntax_error":
      Notice.error(`${t("Merge File Syntax Error")} ${msg}`);
      break;
    case "config_validate::merge_mapping_error":
      Notice.error(`${t("Merge File Mapping Error")} ${msg}`);
      break;
    case "config_validate::merge_key_error":
      Notice.error(`${t("Merge File Key Error")} ${msg}`);
      break;
    case "config_validate::merge_error":
      Notice.error(`${t("Merge File Error")} ${msg}`);
      break;
    case "config_core::change_success":
      Notice.success(`${t("Core Changed Successfully")}: ${msg}`);
      break;
    case "config_core::change_error":
      Notice.error(`${t("Failed to Change Core")}: ${msg}`);
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
      // 使用本地存储中的enableLog值初始化全局日志服务
      initGlobalLogService(server, secret, enableLog, "info");
    }
  }, [clashInfo, enableLog]);

  // 设置监听器
  useEffect(() => {
    const listeners = [
      // 配置更新监听
      addListener("verge://refresh-clash-config", async () => {
        await getAxios(true);
        mutate("getProxies");
        mutate("getVersion");
        mutate("getClashConfig");
        mutate("getProxyProviders");
      }),

      // verge 配置更新监听
      addListener("verge://refresh-verge-config", () => {
        mutate("getVergeConfig");
        // 添加对系统代理状态的刷新
        mutate("getSystemProxy");
        mutate("getAutotemProxy");
      }),

      // 通知消息监听
      addListener("verge://notice-message", ({ payload }) =>
        handleNotice(payload as [string, string]),
      ),
    ];

    // 设置窗口显示/隐藏监听
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

    // 初始化
    setupCloseListener();
    const cleanupWindow = setupWindowListeners();

    // 清理函数
    return () => {
      // 清理主要监听器
      listeners.forEach((listener) => {
        if (typeof listener.then === "function") {
          listener.then((unlisten) => unlisten());
        }
      });
      // 清理窗口监听器
      cleanupWindow.then((cleanup) => cleanup());
    };
  }, [handleNotice]);

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
              <div
                className="the-dragbar"
                data-tauri-drag-region="true"
                style={{ width: "100%" }}
              />
              {OS !== "macos" && <LayoutControl />}
            </div>

            <TransitionGroup className="the-content">
              <CSSTransition
                key={location.pathname}
                timeout={300}
                classNames="page"
              >
                {React.cloneElement(routersEles, { key: location.pathname })}
              </CSSTransition>
            </TransitionGroup>
          </div>
        </Paper>
      </ThemeProvider>
    </SWRConfig>
  );
};

export default Layout;
