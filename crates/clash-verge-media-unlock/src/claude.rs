use reqwest::Client;

use super::UnlockItem;

pub(crate) const CLAUDE_NAME: &str = "Claude";
const BLOCKED_CODES: [&str; 10] = ["AF", "BY", "CN", "CU", "HK", "IR", "KP", "MO", "RU", "SY"];

pub(super) async fn check_claude(client: &Client) -> UnlockItem {
    let url = "https://claude.ai/cdn-cgi/trace";

    match client.get(url).send().await {
        Ok(response) => match response.text().await {
            Ok(body) => {
                let mut country_code: Option<String> = None;

                for line in body.lines() {
                    if let Some(rest) = line.strip_prefix("loc=") {
                        country_code = Some(rest.trim().to_uppercase());
                        break;
                    }
                }

                if let Some(code) = country_code {
                    let status = if BLOCKED_CODES.contains(&code.as_str()) {
                        "No"
                    } else {
                        "Yes"
                    };

                    UnlockItem::checked_region(CLAUDE_NAME, status, &code)
                } else {
                    UnlockItem::checked(CLAUDE_NAME, "Failed", None)
                }
            }
            Err(_) => UnlockItem::checked(CLAUDE_NAME, "Failed", None),
        },
        Err(_) => UnlockItem::checked(CLAUDE_NAME, "Failed", None),
    }
}
