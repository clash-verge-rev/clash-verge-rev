use chrono::Local;
use rust_iso3166;

pub fn get_local_date_string() -> String {
    let now = Local::now();
    now.format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn country_code_to_emoji(country_code: &str) -> String {
    let uc = country_code.to_ascii_uppercase();

    // 长度校验：仅允许 2 或 3
    match uc.len() {
        2 => {
            // 校验是否是合法 alpha2
            if rust_iso3166::from_alpha2(&uc).is_none() {
                return String::new();
            }
            alpha2_to_emoji(&uc)
        }
        3 => {
            // 转换并校验 alpha3
            match rust_iso3166::from_alpha3(&uc) {
                Some(c) => {
                    let alpha2 = c.alpha2.to_ascii_uppercase();
                    alpha2_to_emoji(&alpha2)
                }
                None => String::new(),
            }
        }
        _ => String::new(),
    }
}

fn alpha2_to_emoji(alpha2: &str) -> String {
    let bytes = alpha2.as_bytes();
    let c1 = 0x1F1E6 + (bytes[0] as u32) - ('A' as u32);
    let c2 = 0x1F1E6 + (bytes[1] as u32) - ('A' as u32);
    char::from_u32(c1)
        .and_then(|x| char::from_u32(c2).map(|y| format!("{x}{y}")))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::country_code_to_emoji;

    #[test]
    fn country_code_to_emoji_iso2() {
        assert_eq!(country_code_to_emoji("CN"), "🇨🇳");
        assert_eq!(country_code_to_emoji("us"), "🇺🇸");
    }

    #[test]
    fn country_code_to_emoji_iso3() {
        assert_eq!(country_code_to_emoji("CHN"), "🇨🇳");
        assert_eq!(country_code_to_emoji("USA"), "🇺🇸");
    }

    #[test]
    fn country_code_to_emoji_invalid() {
        assert_eq!(country_code_to_emoji("XXX"), "");
        assert_eq!(country_code_to_emoji("ZZ"), "");
    }

    #[test]
    fn country_code_to_emoji_short() {
        assert_eq!(country_code_to_emoji("C"), "");
        assert_eq!(country_code_to_emoji(""), "");
    }

    #[test]
    fn country_code_to_emoji_long() {
        assert_eq!(country_code_to_emoji("CNAAA"), "");
    }
}
