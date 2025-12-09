import { showNotice } from "@/services/notice-service";

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
      // 空 msg 传入，我们不希望导致 后端-前端-后端 死循环，这里只做提醒。
      // 未来细分事件通知时，可以考虑传入订阅 ID 或其他标识符
      // navigate("/profile", { state: { current: msg } });
      navigate("/profile");
      showNotice.success(
        "shared.feedback.notifications.importSubscriptionSuccess",
      );
    },
    "import_sub_url::error": () => {
      navigate("/profile");
      showNotice.error(msg);
    },
    "set_config::error": () => showNotice.error(msg),
    update_with_clash_proxy: () =>
      showNotice.success(
        "settings.feedback.notifications.updater.withClashProxySuccess",
        msg,
      ),
    update_failed_even_with_clash: () =>
      showNotice.error(
        "settings.feedback.notifications.updater.withClashProxyFailed",
        msg,
      ),
    "reactivate_profiles::error": () => showNotice.error(msg),
    update_failed: () => showNotice.error(msg),
    "config_validate::boot_error": () =>
      showNotice.error("shared.feedback.validation.config.bootFailed", msg),
    "config_validate::core_change": () =>
      showNotice.error(
        "shared.feedback.validation.config.coreChangeFailed",
        msg,
      ),
    "config_validate::error": () =>
      showNotice.error("shared.feedback.validation.config.failed", msg),
    "config_validate::process_terminated": () =>
      showNotice.error("shared.feedback.validation.config.processTerminated"),
    "config_validate::stdout_error": () =>
      showNotice.error("shared.feedback.validation.config.failed", msg),
    "config_validate::script_error": () =>
      showNotice.error("shared.feedback.validation.script.fileError", msg),
    "config_validate::script_syntax_error": () =>
      showNotice.error("shared.feedback.validation.script.syntaxError", msg),
    "config_validate::script_missing_main": () =>
      showNotice.error("shared.feedback.validation.script.missingMain", msg),
    "config_validate::file_not_found": () =>
      showNotice.error("shared.feedback.validation.script.fileNotFound", msg),
    "config_validate::yaml_syntax_error": () =>
      showNotice.error("shared.feedback.validation.yaml.syntaxError", msg),
    "config_validate::yaml_read_error": () =>
      showNotice.error("shared.feedback.validation.yaml.readError", msg),
    "config_validate::yaml_mapping_error": () =>
      showNotice.error("shared.feedback.validation.yaml.mappingError", msg),
    "config_validate::yaml_key_error": () =>
      showNotice.error("shared.feedback.validation.yaml.keyError", msg),
    "config_validate::yaml_error": () =>
      showNotice.error("shared.feedback.validation.yaml.generalError", msg),
    "config_validate::merge_syntax_error": () =>
      showNotice.error("shared.feedback.validation.merge.syntaxError", msg),
    "config_validate::merge_mapping_error": () =>
      showNotice.error("shared.feedback.validation.merge.mappingError", msg),
    "config_validate::merge_key_error": () =>
      showNotice.error("shared.feedback.validation.merge.keyError", msg),
    "config_validate::merge_error": () =>
      showNotice.error("shared.feedback.validation.merge.generalError", msg),
    "config_core::change_success": () =>
      showNotice.success(
        "settings.feedback.notifications.clash.changeSuccess",
        msg,
      ),
    "config_core::change_error": () =>
      showNotice.error(
        "settings.feedback.notifications.clash.changeFailed",
        msg,
      ),
  };

  const handler = handlers[status];
  if (handler) {
    handler();
  } else {
    console.warn(`未处理的通知状态: ${status}`);
  }
};
