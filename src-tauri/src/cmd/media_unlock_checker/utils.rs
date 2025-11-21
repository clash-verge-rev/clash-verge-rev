use chrono::Local;

pub fn get_local_date_string() -> String {
    let now = Local::now();
    now.format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn iso3_to_iso2(code: &str) -> Option<&'static str> {
    // 简单映射常用国家的ISO3到ISO2
    match code.to_uppercase().as_str() {
        // 常用国家
        "CHN" => Some("CN"),
        "USA" => Some("US"),
        "JPN" => Some("JP"),
        "KOR" => Some("KR"),
        "HKG" => Some("HK"),
        "TWN" => Some("TW"),
        "GBR" => Some("GB"),
        "DEU" => Some("DE"),
        "FRA" => Some("FR"),
        "CAN" => Some("CA"),
        "AUS" => Some("AU"),
        "SGP" => Some("SG"),
        _ => None,
    }
}

pub fn country_code_to_emoji(country_code: &str) -> String {
    let country_code_upper = country_code.to_uppercase();
    if country_code_upper.len() < 2 {
        return String::new();
    }
    let country_code_alpha2 = if country_code_upper.len() == 3 {
        iso3_to_iso2(&country_code_upper)
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
