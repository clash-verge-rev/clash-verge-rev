import {
  createPrefixedNotice,
  createRawNotice,
  showNotice,
} from "@/services/noticeService";

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
      showNotice.success({ i18nKey: "Import Subscription Successful" });
    },
    "import_sub_url::error": () => {
      navigate("/profile");
      showNotice.error(createRawNotice(msg));
    },
    "set_config::error": () => showNotice.error(createRawNotice(msg)),
    update_with_clash_proxy: () =>
      showNotice.success(
        createPrefixedNotice(t("Update with Clash proxy successfully"), msg),
      ),
    update_retry_with_clash: () =>
      showNotice.info({
        i18nKey: "Update failed, retrying with Clash proxy...",
      }),
    update_failed_even_with_clash: () =>
      showNotice.error(
        createPrefixedNotice(
          `${t("Update failed even with Clash proxy")}:`,
          msg,
        ),
      ),
    update_failed: () => showNotice.error(createRawNotice(msg)),
    "config_validate::boot_error": () =>
      showNotice.error(
        createPrefixedNotice(t("Boot Config Validation Failed"), msg),
      ),
    "config_validate::core_change": () =>
      showNotice.error(
        createPrefixedNotice(t("Core Change Config Validation Failed"), msg),
      ),
    "config_validate::error": () =>
      showNotice.error(
        createPrefixedNotice(t("Config Validation Failed"), msg),
      ),
    "config_validate::process_terminated": () =>
      showNotice.error({
        i18nKey: "Config Validation Process Terminated",
      }),
    "config_validate::stdout_error": () =>
      showNotice.error(
        createPrefixedNotice(t("Config Validation Failed"), msg),
      ),
    "config_validate::script_error": () =>
      showNotice.error(createPrefixedNotice(t("Script File Error"), msg)),
    "config_validate::script_syntax_error": () =>
      showNotice.error(createPrefixedNotice(t("Script Syntax Error"), msg)),
    "config_validate::script_missing_main": () =>
      showNotice.error(createPrefixedNotice(t("Script Missing Main"), msg)),
    "config_validate::file_not_found": () =>
      showNotice.error(createPrefixedNotice(t("File Not Found"), msg)),
    "config_validate::yaml_syntax_error": () =>
      showNotice.error(createPrefixedNotice(t("YAML Syntax Error"), msg)),
    "config_validate::yaml_read_error": () =>
      showNotice.error(createPrefixedNotice(t("YAML Read Error"), msg)),
    "config_validate::yaml_mapping_error": () =>
      showNotice.error(createPrefixedNotice(t("YAML Mapping Error"), msg)),
    "config_validate::yaml_key_error": () =>
      showNotice.error(createPrefixedNotice(t("YAML Key Error"), msg)),
    "config_validate::yaml_error": () =>
      showNotice.error(createPrefixedNotice(t("YAML Error"), msg)),
    "config_validate::merge_syntax_error": () =>
      showNotice.error(createPrefixedNotice(t("Merge File Syntax Error"), msg)),
    "config_validate::merge_mapping_error": () =>
      showNotice.error(
        createPrefixedNotice(t("Merge File Mapping Error"), msg),
      ),
    "config_validate::merge_key_error": () =>
      showNotice.error(createPrefixedNotice(t("Merge File Key Error"), msg)),
    "config_validate::merge_error": () =>
      showNotice.error(createPrefixedNotice(t("Merge File Error"), msg)),
    "config_core::change_success": () =>
      showNotice.success(
        createPrefixedNotice(`${t("Core Changed Successfully")}:`, msg),
      ),
    "config_core::change_error": () =>
      showNotice.error(
        createPrefixedNotice(`${t("Failed to Change Core")}:`, msg),
      ),
  };

  const handler = handlers[status];
  if (handler) {
    handler();
  } else {
    console.warn(`未处理的通知状态: ${status}`);
  }
};
