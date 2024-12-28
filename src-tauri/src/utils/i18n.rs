use std::{fs, path::Path};
use crate::config::Config;
use sys_locale;

pub fn get_supported_languages() -> Vec<String> {
    let project_dir = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let i18n_path = project_dir.join("src/services/i18n.ts");
    
    if let Ok(content) = fs::read_to_string(i18n_path) {
        let mut languages = Vec::new();
        for line in content.lines() {
            if line.contains("resources = {") {
                for line in content.lines() {
                    if let Some(lang) = line.trim().strip_suffix(": { translation:") {
                        let lang = lang.trim().trim_matches('"');
                        if !lang.is_empty() {
                            languages.push(lang.to_string());
                        }
                    }
                    if line.contains("};") {
                        break;
                    }
                }
                break;
            }
        }
        if !languages.is_empty() {
            return languages;
        }
    }
    
    vec!["en".to_string(), "ru".to_string(), "zh".to_string(), "fa".to_string()]
}

pub fn t(text: &str) -> String {
    let config = Config::verge();
    let verge = config.latest();
    let current_lang = verge.language.as_ref().map_or_else(
        || get_system_language(),
        |lang| lang.to_string()
    );

    text.to_string()
}

fn get_system_language() -> String {
    let sys_lang = sys_locale::get_locale()
        .unwrap_or_else(|| String::from("en"))
        .to_lowercase();
    
    let lang_code = sys_lang.split(['_', '-']).next().unwrap_or("en");
    let supported_languages = get_supported_languages();
    
    if supported_languages.contains(&lang_code.to_string()) {
        lang_code.to_string()
    } else {
        String::from("en")
    }
}
