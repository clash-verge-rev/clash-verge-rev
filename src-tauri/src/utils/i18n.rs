use crate::config::Config;
use sys_locale;

const DEFAULT_LANGUAGE: &str = "zh";

fn supported_languages_internal() -> Vec<&'static str> {
    rust_i18n::available_locales!()
}

const fn fallback_language() -> &'static str {
    DEFAULT_LANGUAGE
}

fn locale_alias(locale: &str) -> Option<&'static str> {
    match locale {
        "ja" | "ja-jp" | "jp" => Some("jp"),
        "zh" | "zh-cn" | "zh-hans" | "zh-sg" | "zh-my" | "zh-chs" => Some("zh"),
        "zh-tw" | "zh-hk" | "zh-hant" | "zh-mo" | "zh-cht" => Some("zhtw"),
        _ => None,
    }
}

fn resolve_supported_language(language: &str) -> Option<String> {
    if language.is_empty() {
        return None;
    }

    let normalized = language.to_lowercase().replace('_', "-");

    let mut candidates: Vec<String> = Vec::new();
    let mut push_candidate = |candidate: String| {
        if !candidate.is_empty()
            && !candidates
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&candidate))
        {
            candidates.push(candidate);
        }
    };

    let segments: Vec<&str> = normalized.split('-').collect();

    for i in (1..=segments.len()).rev() {
        let prefix = segments[..i].join("-");
        if let Some(alias) = locale_alias(&prefix) {
            push_candidate(alias.to_string());
        }
        push_candidate(prefix);
    }

    let supported = supported_languages_internal();

    candidates
        .into_iter()
        .find(|candidate| supported.iter().any(|&lang| lang.eq_ignore_ascii_case(candidate)))
}

fn system_language() -> String {
    sys_locale::get_locale()
        .as_deref()
        .and_then(resolve_supported_language)
        .unwrap_or_else(|| fallback_language().to_string())
}

pub fn get_supported_languages() -> Vec<String> {
    supported_languages_internal()
        .into_iter()
        .map(|lang| lang.to_string())
        .collect()
}

pub fn set_locale(language: &str) {
    let lang = resolve_supported_language(language).unwrap_or_else(|| fallback_language().to_string());
    rust_i18n::set_locale(&lang);
}

pub async fn current_language() -> String {
    Config::verge()
        .await
        .latest_arc()
        .language
        .as_ref()
        .filter(|lang| !lang.is_empty())
        .and_then(|lang| resolve_supported_language(lang))
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
