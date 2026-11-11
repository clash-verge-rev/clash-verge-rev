use reqwest::Client;

use crate::utils::{classify_restricted_status, get_trace_location};

use super::UnlockItem;

pub(crate) const MUSE_AI_NAME: &str = "Muse AI";

const MUSE_URL: &str = "https://muse.ai";
const CLOUDFLARE_TRACE_URL: &str = "https://www.cloudflare.com/cdn-cgi/trace";

// The aymh ("Are You a Human") gateway answers plain HTTP requests with a
// generic Meta error page that always contains the Facebook logo asset.
const AYMH_ERROR_MARKERS: &[&str] = &["Sorry, something went wrong", "static.facebook.com/images/logos"];

pub(super) async fn check_muse_ai(client: &Client) -> UnlockItem {
    // muse.ai itself is served by Vercel, so resolve the exit region through
    // the generic Cloudflare trace endpoint instead of a service-specific one.
    let region = get_trace_location(client, CLOUDFLARE_TRACE_URL)
        .await
        .map(|code| code.trim().to_ascii_uppercase())
        .map(|code| UnlockItem::region_label(&code));

    let Ok(response) = client.get(MUSE_URL).send().await else {
        return UnlockItem::checked(MUSE_AI_NAME, "Failed (Network Connection)", region);
    };

    let status = response.status();
    let landed_on_aymh = response.url().host_str() == Some("auth.muse.ai");
    let body = response.text().await.unwrap_or_default();

    // Every region is redirected to the aymh anti-bot gateway before the app
    // loads, and a non-browser HTTP client cannot finish the JavaScript
    // challenge. It returns the Meta error page, so reaching this point only
    // proves the exit can connect to Muse's auth infrastructure; availability
    // cannot be verified over plain HTTP and is reported as `Risky`.
    let behind_anti_bot = landed_on_aymh || AYMH_ERROR_MARKERS.iter().any(|marker| body.contains(marker));

    let result = if behind_anti_bot {
        "Risky"
    } else if status.is_success() {
        "Yes"
    } else {
        classify_restricted_status(status).unwrap_or("Failed")
    };

    UnlockItem::checked(MUSE_AI_NAME, result, region)
}
