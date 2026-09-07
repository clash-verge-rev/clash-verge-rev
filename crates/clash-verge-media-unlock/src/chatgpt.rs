use reqwest::Client;

use crate::utils::{get_text, get_trace_location};

use super::UnlockItem;

pub(crate) const CHATGPT_WEB_NAME: &str = "ChatGPT Web";

pub(super) async fn check_chatgpt(client: &Client) -> UnlockItem {
    let region = get_trace_location(client, "https://chat.openai.com/cdn-cgi/trace")
        .await
        .map(|loc| UnlockItem::region_label(&loc));

    let web_status = get_text(client, "https://api.openai.com/compliance/cookie_requirements")
        .await
        .map(|body| {
            if body.to_ascii_lowercase().contains("unsupported_country") {
                "Unsupported Country/Region"
            } else {
                "Yes"
            }
        })
        .unwrap_or("Failed");

    UnlockItem::checked(CHATGPT_WEB_NAME, web_status, region)
}
