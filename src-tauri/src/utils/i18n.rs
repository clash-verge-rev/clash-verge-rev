use crate::config::Config;
use sys_locale;

const DEFAULT_LANGUAGE: &str = "zh";

fn supported_languages_internal() -> Vec<&'static str> {
    rust_i18n::available_locales!()
}

fn is_supported(language: &str) -> bool {
    let normalized = language.to_lowercase();
    supported_languages_internal()
        .iter()
        .any(|&lang| lang.eq_ignore_ascii_case(&normalized))
}

const fn fallback_language() -> &'static str {
    DEFAULT_LANGUAGE
}

fn system_language() -> String {
    sys_locale::get_locale()
        .map(|locale| locale.to_lowercase())
        .and_then(|locale| locale.split(['_', '-']).next().map(str::to_string))
        .filter(|lang| is_supported(lang))
        .unwrap_or_else(|| fallback_language().to_string())
}

pub fn get_supported_languages() -> Vec<String> {
    supported_languages_internal()
        .into_iter()
        .map(|lang| lang.to_string())
        .collect()
}

pub fn set_locale(language: &str) {
    let normalized = language.to_lowercase();
    let lang = if is_supported(&normalized) {
        normalized
    } else {
        fallback_language().to_string()
    };
    rust_i18n::set_locale(&lang);
}

pub async fn current_language() -> String {
    Config::verge()
        .await
        .latest_arc()
        .language
        .clone()
        .filter(|lang| !lang.is_empty())
        .map(|lang| lang.to_lowercase())
        .filter(|lang| is_supported(lang))
        .unwrap_or_else(system_language)
}

pub async fn sync_locale() -> String {
    let language = current_language().await;
    set_locale(&language);
    language
}

pub const fn default_language() -> &'static str {
    fallback_language()
}
