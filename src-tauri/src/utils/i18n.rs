use crate::{config::Config, utils::dirs};
use once_cell::sync::Lazy;
use serde_json::Value;
use std::{fs, path::PathBuf, sync::RwLock};
use sys_locale;

const DEFAULT_LANGUAGE: &str = "zh";

fn get_locales_dir() -> Option<PathBuf> {
    dirs::app_resources_dir()
        .map(|resource_path| resource_path.join("locales"))
        .ok()
}

pub fn get_supported_languages() -> Vec<String> {
    let mut languages = Vec::new();

    if let Some(locales_dir) = get_locales_dir()
        && let Ok(entries) = fs::read_dir(locales_dir)
    {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str()
                && let Some(lang) = file_name.strip_suffix(".json")
            {
                languages.push(lang.to_string());
            }
        }
    }

    if languages.is_empty() {
        languages.push(DEFAULT_LANGUAGE.to_string());
    }
    languages
}

static TRANSLATIONS: Lazy<RwLock<(String, Value)>> = Lazy::new(|| {
    let lang = get_system_language();
    let json = load_lang_file(&lang).unwrap_or_else(|| Value::Object(Default::default()));
    RwLock::new((lang, json))
});

fn load_lang_file(lang: &str) -> Option<Value> {
    let locales_dir = get_locales_dir()?;
    let file_path = locales_dir.join(format!("{lang}.json"));
    fs::read_to_string(file_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

fn get_system_language() -> String {
    sys_locale::get_locale()
        .map(|locale| locale.to_lowercase())
        .and_then(|locale| locale.split(['_', '-']).next().map(String::from))
        .filter(|lang| get_supported_languages().contains(lang))
        .unwrap_or_else(|| DEFAULT_LANGUAGE.to_string())
}

pub async fn t(key: &str) -> String {
    let current_lang = Config::verge()
        .await
        .latest_ref()
        .language
        .as_deref()
        .map(String::from)
        .unwrap_or_else(get_system_language);

    {
        if let Ok(cache) = TRANSLATIONS.read()
            && cache.0 == current_lang
            && let Some(text) = cache.1.get(key).and_then(|val| val.as_str())
        {
            return text.to_string();
        }
    }

    if let Some(new_json) = load_lang_file(&current_lang)
        && let Ok(mut cache) = TRANSLATIONS.write()
    {
        *cache = (current_lang.clone(), new_json);

        if let Some(text) = cache.1.get(key).and_then(|val| val.as_str()) {
            return text.to_string();
        }
    }

    if current_lang != DEFAULT_LANGUAGE
        && let Some(default_json) = load_lang_file(DEFAULT_LANGUAGE)
        && let Ok(mut cache) = TRANSLATIONS.write()
    {
        *cache = (DEFAULT_LANGUAGE.to_string(), default_json);

        if let Some(text) = cache.1.get(key).and_then(|val| val.as_str()) {
            return text.to_string();
        }
    }

    key.to_string()
}
