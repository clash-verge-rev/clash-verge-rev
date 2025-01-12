use crate::config::Config;
use once_cell::sync::Lazy;
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path};
use sys_locale;

pub fn get_supported_languages() -> Vec<String> {
    let project_dir = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let locales_dir = project_dir.join("src/locales");
    let mut languages = Vec::new();

    if let Ok(entries) = fs::read_dir(locales_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if let Some(lang) = file_name.strip_suffix(".json") {
                    languages.push(lang.to_string());
                }
            }
        }
    }
    languages
}

static TRANSLATIONS: Lazy<HashMap<String, Value>> = Lazy::new(|| {
    let project_dir = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let locales_dir = project_dir.join("src/locales");
    let mut translations = HashMap::new();

    for lang in get_supported_languages() {
        let file_path = locales_dir.join(format!("{}.json", lang));
        if let Ok(content) = fs::read_to_string(file_path) {
            if let Ok(json) = serde_json::from_str(&content) {
                translations.insert(lang.to_string(), json);
            }
        }
    }
    translations
});

pub fn t(key: &str) -> String {
    let config = Config::verge();
    let verge = config.latest();
    let current_lang = verge
        .language
        .as_ref()
        .map_or_else(|| get_system_language(), |lang| lang.to_string());

    if let Some(translations) = TRANSLATIONS.get(&current_lang) {
        if let Some(text) = translations.get(key) {
            if let Some(text) = text.as_str() {
                return text.to_string();
            }
        }
    }

    // Fallback to Chinese
    if let Some(translations) = TRANSLATIONS.get("zh") {
        if let Some(text) = translations.get(key) {
            if let Some(text) = text.as_str() {
                return text.to_string();
            }
        }
    }

    key.to_string()
}

fn get_system_language() -> String {
    let sys_lang = sys_locale::get_locale()
        .unwrap_or_else(|| String::from("zh"))
        .to_lowercase();

    let lang_code = sys_lang.split(['_', '-']).next().unwrap_or("zh");
    let supported_languages = get_supported_languages();

    if supported_languages.contains(&lang_code.to_string()) {
        lang_code.to_string()
    } else {
        String::from("zh")
    }
}
