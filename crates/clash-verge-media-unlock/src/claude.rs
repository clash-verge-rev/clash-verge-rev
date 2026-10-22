use reqwest::Client;

use crate::utils::get_trace_location;

use super::UnlockItem;

pub(crate) const CLAUDE_NAME: &str = "Claude";

const BLOCKED_CODES: &[&str] = &["AF", "BY", "CN", "CU", "HK", "IR", "KP", "MO", "RU", "SY"];

pub(super) async fn check_claude(client: &Client) -> UnlockItem {
    let code = get_trace_location(client, "https://claude.ai/cdn-cgi/trace")
        .await
        .map(|code| code.trim().to_ascii_uppercase());

    let Some(code) = code else {
        return UnlockItem::checked(CLAUDE_NAME, "Failed", None);
    };

    let status = if BLOCKED_CODES.contains(&code.as_str()) {
        "No"
    } else {
        "Yes"
    };

    UnlockItem::checked_region(CLAUDE_NAME, status, &code)
}
