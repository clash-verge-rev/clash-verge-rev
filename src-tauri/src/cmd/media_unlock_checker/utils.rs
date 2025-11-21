use chrono::Local;
use rust_iso3166;

pub fn get_local_date_string() -> String {
    let now = Local::now();
    now.format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn country_code_to_emoji(country_code: &str) -> String {
    let country_code_upper = country_code.to_uppercase();
    if country_code_upper.len() < 2 {
        return String::new();
    }
    let country_code_alpha2 = if country_code_upper.len() == 3 {
        rust_iso3166::from_alpha3(&country_code_upper)
            .map(|c| c.alpha2)
            .unwrap_or(&country_code_upper)
            .to_string()
    } else {
        country_code_upper.chars().take(2).collect::<String>()
    };

    let bytes = country_code_alpha2.as_bytes();
    let c1 = 0x1F1E6 + (bytes[0] as u32) - ('A' as u32);
    let c2 = 0x1F1E6 + (bytes[1] as u32) - ('A' as u32);

    char::from_u32(c1)
        .and_then(|c1| char::from_u32(c2).map(|c2| format!("{c1}{c2}")))
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
    fn country_code_to_emoji_short() {
        assert_eq!(country_code_to_emoji("C"), "");
        assert_eq!(country_code_to_emoji(""), "");
    }

    #[test]
    fn country_code_to_emoji_long() {
        assert_eq!(country_code_to_emoji("CNAAA"), "🇨🇳");
    }
}
