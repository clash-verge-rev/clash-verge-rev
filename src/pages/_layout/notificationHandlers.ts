import { showNotice } from "@/services/noticeService";

type NavigateFunction = (path: string, options?: any) => void;
type TranslateFunction = (key: string) => string;

export const handleNoticeMessage = (
  status: string,
  msg: string,
  t: TranslateFunction,
  navigate: NavigateFunction,
) => {
  const handlers: Record<string, () => void> = {
    "import_sub_url::ok": () => {
      navigate("/profile", { state: { current: msg } });
      showNotice.success("profiles.notifications.importSubscriptionSuccess");
    },
    "import_sub_url::error": () => {
      navigate("/profile");
      showNotice.error(msg);
    },
    "set_config::error": () => showNotice.error(msg),
    update_with_clash_proxy: () =>
      showNotice.success(
        "settings.updater.notifications.withClashProxySuccess",
        msg,
      ),
    update_failed_even_with_clash: () =>
      showNotice.error(
        "settings.updater.notifications.withClashProxyFailed",
        msg,
      ),
    update_failed: () => showNotice.error(msg),
    "config_validate::boot_error": () =>
      showNotice.error("validation.config.bootFailed", msg),
    "config_validate::core_change": () =>
      showNotice.error("validation.config.coreChangeFailed", msg),
    "config_validate::error": () =>
      showNotice.error("validation.config.failed", msg),
    "config_validate::process_terminated": () =>
      showNotice.error("validation.config.processTerminated"),
    "config_validate::stdout_error": () =>
      showNotice.error("validation.config.failed", msg),
    "config_validate::script_error": () =>
      showNotice.error("validation.script.fileError", msg),
    "config_validate::script_syntax_error": () =>
      showNotice.error("validation.script.syntaxError", msg),
    "config_validate::script_missing_main": () =>
      showNotice.error("validation.script.missingMain", msg),
    "config_validate::file_not_found": () =>
      showNotice.error("validation.script.fileNotFound", msg),
    "config_validate::yaml_syntax_error": () =>
      showNotice.error("validation.yaml.syntaxError", msg),
    "config_validate::yaml_read_error": () =>
      showNotice.error("validation.yaml.readError", msg),
    "config_validate::yaml_mapping_error": () =>
      showNotice.error("validation.yaml.mappingError", msg),
    "config_validate::yaml_key_error": () =>
      showNotice.error("validation.yaml.keyError", msg),
    "config_validate::yaml_error": () =>
      showNotice.error("validation.yaml.generalError", msg),
    "config_validate::merge_syntax_error": () =>
      showNotice.error("validation.merge.syntaxError", msg),
    "config_validate::merge_mapping_error": () =>
      showNotice.error("validation.merge.mappingError", msg),
    "config_validate::merge_key_error": () =>
      showNotice.error("validation.merge.keyError", msg),
    "config_validate::merge_error": () =>
      showNotice.error("validation.merge.generalError", msg),
    "config_core::change_success": () =>
      showNotice.success("settings.clash.notifications.changeSuccess", msg),
    "config_core::change_error": () =>
      showNotice.error("settings.clash.notifications.changeFailed", msg),
  };

  const handler = handlers[status];
  if (handler) {
    handler();
  } else {
    console.warn(`未处理的通知状态: ${status}`);
  }
};
