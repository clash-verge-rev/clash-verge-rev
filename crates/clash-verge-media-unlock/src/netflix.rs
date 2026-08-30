use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Deserialize;

use clash_verge_logging::{Type, logging};

use super::UnlockItem;

pub(crate) const NETFLIX_NAME: &str = "Netflix";

const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
struct FastResponse {
    targets: Vec<FastTarget>,
}

#[derive(Deserialize)]
struct FastTarget {
    location: FastLocation,
}

#[derive(Deserialize)]
struct FastLocation {
    country: String,
}

fn item(status: impl Into<String>) -> UnlockItem {
    UnlockItem::checked(NETFLIX_NAME, status, None)
}

pub(super) async fn check_netflix(client: &Client) -> UnlockItem {
    let cdn = check_netflix_cdn(client).await;
    if cdn.status == "Yes" || cdn.status.starts_with("No") {
        return cdn;
    }

    let (r1, r2) = tokio::join!(check_title(client, "81280792"), check_title(client, "70143836"),);

    let (Ok(status1), Ok(status2)) = (r1, r2) else {
        return item("Failed");
    };

    if status1 == StatusCode::NOT_FOUND && status2 == StatusCode::NOT_FOUND {
        return item("Originals Only");
    }

    if status1 == StatusCode::FORBIDDEN || status2 == StatusCode::FORBIDDEN {
        return item("No");
    }

    if [status1, status2]
        .iter()
        .any(|s| matches!(*s, StatusCode::OK | StatusCode::MOVED_PERMANENTLY))
    {
        return check_region(client).await;
    }

    item(format!("Failed (状态码: {status1}_{status2})"))
}

async fn check_title(client: &Client, id: &str) -> reqwest::Result<StatusCode> {
    client
        .get(format!("https://www.netflix.com/title/{id}"))
        .timeout(TIMEOUT)
        .send()
        .await
        .map(|res| res.status())
}

async fn check_region(client: &Client) -> UnlockItem {
    let response = match client
        .get("https://www.netflix.com/title/80018499")
        .timeout(TIMEOUT)
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            logging!(error, Type::Network, "获取 Netflix 区域信息失败: {e}");
            return item("Yes (但无法获取区域)");
        }
    };

    let region = response
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .and_then(|location| location.split('/').nth(3))
        .and_then(|region| region.split('-').next())
        .filter(|region| !region.is_empty())
        .unwrap_or("us");

    UnlockItem::checked_region(NETFLIX_NAME, "Yes", region)
}

async fn check_netflix_cdn(client: &Client) -> UnlockItem {
    let response = match client
        .get("https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5")
        .timeout(TIMEOUT)
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            logging!(error, Type::Network, "Fast.com API 请求失败: {e}");
            return item("Failed (CDN API)");
        }
    };

    if response.status() == StatusCode::FORBIDDEN {
        return item("No (IP Banned By Netflix)");
    }

    match response.json::<FastResponse>().await {
        Ok(data) => data
            .targets
            .first()
            .map(|target| UnlockItem::checked_region(NETFLIX_NAME, "Yes", &target.location.country))
            .unwrap_or_else(|| item("Unknown")),
        Err(e) => {
            logging!(error, Type::Network, "解析 Fast.com API 响应失败: {e}");
            item("Failed (解析错误)")
        }
    }
}
