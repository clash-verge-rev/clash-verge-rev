use serde::Serialize;
use tauri::{Manager, ResourceId, Runtime, webview::Webview};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use super::{CmdResult, String};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpdateChannel {
    Stable,
    Autobuild,
}

impl TryFrom<&str> for UpdateChannel {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "stable" => Ok(Self::Stable),
            "autobuild" => Ok(Self::Autobuild),
            other => Err(String::from(format!("Unsupported channel \"{other}\""))),
        }
    }
}

const CHANNEL_RELEASE_TAGS: &[(UpdateChannel, &str)] = &[
    (UpdateChannel::Stable, "updater"),
    (UpdateChannel::Autobuild, "updater-autobuild"),
];

const CHANNEL_ENDPOINT_TEMPLATES: &[&str] = &[
    "https://download.clashverge.dev/https://github.com/clash-verge-rev/clash-verge-rev/releases/download/{release}/update-proxy.json",
    "https://gh-proxy.com/https://github.com/clash-verge-rev/clash-verge-rev/releases/download/{release}/update-proxy.json",
    "https://github.com/clash-verge-rev/clash-verge-rev/releases/download/{release}/update.json",
];

fn resolve_release_tag(channel: UpdateChannel) -> CmdResult<&'static str> {
    CHANNEL_RELEASE_TAGS
        .iter()
        .find_map(|(entry_channel, tag)| (*entry_channel == channel).then_some(*tag))
        .ok_or_else(|| {
            String::from(format!(
                "No release tag registered for update channel \"{channel:?}\""
            ))
        })
}

fn resolve_channel_endpoints(channel: UpdateChannel) -> CmdResult<Vec<Url>> {
    let release_tag = resolve_release_tag(channel)?;
    CHANNEL_ENDPOINT_TEMPLATES
        .iter()
        .map(|template| {
            let endpoint = template.replace("{release}", release_tag);
            Url::parse(&endpoint).map_err(|err| {
                String::from(format!(
                    "Failed to parse updater endpoint \"{endpoint}\": {err}"
                ))
            })
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn check_update_channel<R: Runtime>(
    webview: Webview<R>,
    channel: String,
    headers: Option<Vec<(String, String)>>,
    timeout: Option<u64>,
    proxy: Option<String>,
    target: Option<String>,
    allow_downgrades: Option<bool>,
) -> CmdResult<Option<UpdateMetadata>> {
    let channel_enum = UpdateChannel::try_from(channel.as_str())?;
    let endpoints = resolve_channel_endpoints(channel_enum)?;

    let mut builder = webview
        .updater_builder()
        .endpoints(endpoints)
        .map_err(|err| String::from(err.to_string()))?;

    if let Some(headers) = headers {
        for (key, value) in headers {
            builder = builder
                .header(key.as_str(), value.as_str())
                .map_err(|err| String::from(err.to_string()))?;
        }
    }

    if let Some(timeout) = timeout {
        builder = builder.timeout(std::time::Duration::from_millis(timeout));
    }

    if let Some(proxy) = proxy {
        let proxy_url = Url::parse(&proxy)
            .map_err(|err| String::from(format!("Invalid proxy URL \"{proxy}\": {err}")))?;
        builder = builder.proxy(proxy_url);
    }

    if let Some(target) = target {
        builder = builder.target(target);
    }

    let allow_downgrades = allow_downgrades.unwrap_or(channel_enum != UpdateChannel::Stable);

    if allow_downgrades {
        builder = builder.version_comparator(|current, update| update.version != current);
    }

    let updater = builder
        .build()
        .map_err(|err| String::from(err.to_string()))?;

    let update = updater
        .check()
        .await
        .map_err(|err| String::from(err.to_string()))?;

    let Some(update) = update else {
        return Ok(None);
    };

    let formatted_date = update
        .date
        .as_ref()
        .map(|date| String::from(date.to_string()));

    let metadata = UpdateMetadata {
        rid: webview.resources_table().add(update.clone()),
        current_version: String::from(update.current_version.clone()),
        version: String::from(update.version.clone()),
        date: formatted_date,
        body: update.body.clone().map(Into::into),
        raw_json: update.raw_json.clone(),
    };

    Ok(Some(metadata))
}
