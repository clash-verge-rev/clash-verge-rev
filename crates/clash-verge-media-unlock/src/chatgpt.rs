use reqwest::Client;

use crate::utils::{get_text, get_trace_location};

use super::UnlockItem;

pub(crate) const CHATGPT_IOS_NAME: &str = "ChatGPT iOS";
pub(crate) const CHATGPT_WEB_NAME: &str = "ChatGPT Web";

// TODO: remove ios check
pub(super) async fn check_chatgpt_combined(client: &Client) -> Vec<UnlockItem> {
    let region = get_trace_location(client, "https://chat.openai.com/cdn-cgi/trace")
        .await
        .map(|loc| UnlockItem::region_label(&loc));

    let ios_status = get_text(client, "https://ios.chat.openai.com/")
        .await
        .map(|body| {
            let body = body.to_ascii_lowercase();

            if body.contains("you may be connected to a disallowed isp") {
                "Disallowed ISP"
            } else if body.contains("request is not allowed. please try again later.") {
                "Yes"
            } else if body.contains("sorry, you have been blocked") {
                "Blocked"
            } else {
                "Failed"
            }
        })
        .unwrap_or("Failed");

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

    vec![
        UnlockItem::checked(CHATGPT_IOS_NAME, ios_status, region.clone()),
        UnlockItem::checked(CHATGPT_WEB_NAME, web_status, region),
    ]
}
