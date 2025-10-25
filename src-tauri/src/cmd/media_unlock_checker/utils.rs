use chrono::Local;

pub fn get_local_date_string() -> String {
    let now = Local::now();
    now.format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn country_code_to_emoji(country_code: &str) -> String {
    let country_code = country_code.to_uppercase();
    if country_code.len() < 2 {
        return String::new();
    }

    let bytes = country_code.as_bytes();
    let c1 = 0x1F1E6 + (bytes[0] as u32) - ('A' as u32);
    let c2 = 0x1F1E6 + (bytes[1] as u32) - ('A' as u32);

    char::from_u32(c1)
        .and_then(|c1| char::from_u32(c2).map(|c2| format!("{c1}{c2}")))
        .unwrap_or_default()
}
