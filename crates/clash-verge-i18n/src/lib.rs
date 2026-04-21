use rust_i18n::i18n;

const DEFAULT_LANGUAGE: &str = "zh";
i18n!("locales", fallback = "zh");

#[inline]
fn locale_alias(locale: &str) -> Option<&'static str> {
    match locale {
        "ja" | "ja-jp" | "jp" => Some("jp"),
        "zh" | "zh-cn" | "zh-hans" | "zh-sg" | "zh-my" | "zh-chs" => Some("zh"),
        "zh-tw" | "zh-hk" | "zh-hant" | "zh-mo" | "zh-cht" => Some("zhtw"),
        _ => None,
    }
}

#[inline]
fn resolve_supported_language(language: &str) -> Option<&'static str> {
    if language.is_empty() {
        return None;
    }
    let normalized = language.to_lowercase().replace('_', "-");
    let segments: Vec<&str> = normalized.split('-').collect();
    let supported = rust_i18n::available_locales!();
    for i in (1..=segments.len()).rev() {
        let prefix = segments[..i].join("-");
        if let Some(alias) = locale_alias(&prefix)
            && let Some(&found) = supported.iter().find(|&&l| l.eq_ignore_ascii_case(alias))
        {
            return Some(found);
        }
        if let Some(&found) = supported.iter().find(|&&l| l.eq_ignore_ascii_case(&prefix)) {
            return Some(found);
        }
    }
    None
}

#[inline]
fn current_language(language: Option<&str>) -> &str {
    language
        .as_ref()
        .filter(|lang| !lang.is_empty())
        .and_then(|lang| resolve_supported_language(lang))
        .unwrap_or_else(system_language)
}

#[inline]
pub fn system_language() -> &'static str {
    sys_locale::get_locale()
        .as_deref()
        .and_then(resolve_supported_language)
        .unwrap_or(DEFAULT_LANGUAGE)
}

#[inline]
pub fn sync_locale(language: Option<&str>) {
    let language = current_language(language);
    set_locale(language);
}

#[inline]
pub fn set_locale(language: &str) {
    let lang = resolve_supported_language(language).unwrap_or(DEFAULT_LANGUAGE);
    rust_i18n::set_locale(lang);
}

#[inline]
pub fn translate(key: &str) -> Cow<'_, str> {
    rust_i18n::t!(key)
}

#[macro_export]
macro_rules! t {
    ($key:expr) => {
        $crate::translate(&$key)
    };
    ($key:expr, $($arg_name:ident = $arg_value:expr),*) => {
        {
            let mut _text = $crate::translate(&$key);
            $(
                _text = _text.replace(&format!("{{{}}}", stringify!($arg_name)), &$arg_value);
            )*
            _text
        }
    };
}

#[cfg(test)]
mod test {
    use super::resolve_supported_language;

    #[test]
    fn test_resolve_supported_language() {
        assert_eq!(resolve_supported_language("en"), Some("en"));
        assert_eq!(resolve_supported_language("en-US"), Some("en"));
        assert_eq!(resolve_supported_language("zh"), Some("zh"));
        assert_eq!(resolve_supported_language("zh-CN"), Some("zh"));
        assert_eq!(resolve_supported_language("zh-Hant"), Some("zhtw"));
        assert_eq!(resolve_supported_language("jp"), Some("jp"));
        assert_eq!(resolve_supported_language("ja-JP"), Some("jp"));
        assert_eq!(resolve_supported_language("fr"), None);
    }
}
