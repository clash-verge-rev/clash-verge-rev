use crate::{config::Config, utils::dirs};
use once_cell::sync::Lazy;
use smartstring::alias::String;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, RwLock},
};
use sys_locale;

const DEFAULT_LANGUAGE: &str = "zh";

type TranslationMap = (String, HashMap<String, Arc<str>>);

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
                languages.push(lang.into());
            }
        }
    }

    if languages.is_empty() {
        languages.push(DEFAULT_LANGUAGE.into());
    }
    languages
}

pub async fn current_language() -> String {
    Config::verge()
        .await
        .latest_arc()
        .language
        .as_deref()
        .map(String::from)
        .unwrap_or_else(get_system_language)
}

static TRANSLATIONS: Lazy<RwLock<TranslationMap>> = Lazy::new(|| {
    let lang = get_system_language();
    let map = load_lang_file(&lang).unwrap_or_default();
    RwLock::new((lang, map))
});

fn load_lang_file(lang: &str) -> Option<HashMap<String, Arc<str>>> {
    let locales_dir = get_locales_dir()?;
    let file_path = locales_dir.join(format!("{lang}.json"));
    fs::read_to_string(file_path)
        .ok()
        .and_then(|content| serde_json::from_str::<HashMap<String, String>>(&content).ok())
        .map(|map| {
            map.into_iter()
                .map(|(k, v)| (k, Arc::from(v.as_str())))
                .collect()
        })
}

fn get_system_language() -> String {
    sys_locale::get_locale()
        .map(|locale| locale.to_lowercase())
        .and_then(|locale| locale.split(['_', '-']).next().map(String::from))
        .filter(|lang| get_supported_languages().contains(lang))
        .unwrap_or_else(|| DEFAULT_LANGUAGE.into())
}

pub async fn t(key: &str) -> Arc<str> {
    let current_lang = current_language().await;

    {
        if let Ok(cache) = TRANSLATIONS.read()
            && cache.0 == current_lang
            && let Some(text) = cache.1.get(key)
        {
            return Arc::clone(text);
        }
    }

    if let Some(new_map) = load_lang_file(&current_lang)
        && let Ok(mut cache) = TRANSLATIONS.write()
    {
        *cache = (current_lang.clone(), new_map);

        if let Some(text) = cache.1.get(key) {
            return Arc::clone(text);
        }
    }

    if current_lang != DEFAULT_LANGUAGE
        && let Some(default_map) = load_lang_file(DEFAULT_LANGUAGE)
        && let Ok(mut cache) = TRANSLATIONS.write()
    {
        *cache = (DEFAULT_LANGUAGE.into(), default_map);

        if let Some(text) = cache.1.get(key) {
            return Arc::clone(text);
        }
    }

    Arc::from(key)
}
