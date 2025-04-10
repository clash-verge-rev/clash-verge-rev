use chrono::Local;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tauri::command;
use tokio::{sync::Mutex, task::JoinSet};

// 定义解锁测试项目的结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockItem {
    name: String,
    status: String,
    region: Option<String>,
    check_time: Option<String>,
}

// 获取当前本地时间字符串
fn get_local_date_string() -> String {
    let now = Local::now();
    now.format("%Y-%m-%d %H:%M:%S").to_string()
}

// 将国家代码转换为对应的emoji
fn country_code_to_emoji(country_code: &str) -> String {
    // 转换为大写
    let country_code = country_code.to_uppercase();

    // 确保使用国家代码的前两个字符来生成emoji
    if country_code.len() < 2 {
        return String::new();
    }

    // 使用前两个字符生成emoji
    let bytes = country_code.as_bytes();
    let c1 = 0x1F1E6 + (bytes[0] as u32) - ('A' as u32);
    let c2 = 0x1F1E6 + (bytes[1] as u32) - ('A' as u32);

    char::from_u32(c1)
        .and_then(|c1| char::from_u32(c2).map(|c2| format!("{}{}", c1, c2)))
        .unwrap_or_default()
}

// 测试哔哩哔哩中国大陆
async fn check_bilibili_china_mainland(client: &Client) -> UnlockItem {
    let url = "https://api.bilibili.com/pgc/player/web/playurl?avid=82846771&qn=0&type=&otype=json&ep_id=307247&fourk=1&fnver=0&fnval=16&module=bangumi";

    let result = client.get(url).send().await;

    match result {
        Ok(response) => match response.json::<serde_json::Value>().await {
            Ok(body) => {
                if let Some(code) = body.get("code").and_then(|v| v.as_i64()) {
                    let status = if code == 0 {
                        "Yes"
                    } else if code == -10403 {
                        "No"
                    } else {
                        "Failed"
                    };

                    UnlockItem {
                        name: "哔哩哔哩大陆".to_string(),
                        status: status.to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                } else {
                    UnlockItem {
                        name: "哔哩哔哩大陆".to_string(),
                        status: "Failed".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
            }
            Err(_) => UnlockItem {
                name: "哔哩哔哩大陆".to_string(),
                status: "Failed".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            },
        },
        Err(_) => UnlockItem {
            name: "哔哩哔哩大陆".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

// 测试哔哩哔哩港澳台
async fn check_bilibili_hk_mc_tw(client: &Client) -> UnlockItem {
    let url = "https://api.bilibili.com/pgc/player/web/playurl?avid=18281381&cid=29892777&qn=0&type=&otype=json&ep_id=183799&fourk=1&fnver=0&fnval=16&module=bangumi";

    let result = client.get(url).send().await;

    match result {
        Ok(response) => match response.json::<serde_json::Value>().await {
            Ok(body) => {
                if let Some(code) = body.get("code").and_then(|v| v.as_i64()) {
                    let status = if code == 0 {
                        "Yes"
                    } else if code == -10403 {
                        "No"
                    } else {
                        "Failed"
                    };

                    UnlockItem {
                        name: "哔哩哔哩港澳台".to_string(),
                        status: status.to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                } else {
                    UnlockItem {
                        name: "哔哩哔哩港澳台".to_string(),
                        status: "Failed".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
            }
            Err(_) => UnlockItem {
                name: "哔哩哔哩港澳台".to_string(),
                status: "Failed".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            },
        },
        Err(_) => UnlockItem {
            name: "哔哩哔哩港澳台".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

// 合并的ChatGPT检测功能，包含iOS和Web测试以及国家代码获取
async fn check_chatgpt_combined(client: &Client) -> Vec<UnlockItem> {
    // 结果集
    let mut results = Vec::new();

    // 1. 获取国家代码
    let url_country = "https://chat.openai.com/cdn-cgi/trace";
    let result_country = client.get(url_country).send().await;

    // 解析区域信息
    let region = match result_country {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let mut map = HashMap::new();
                for line in body.lines() {
                    if let Some(index) = line.find('=') {
                        let key = &line[0..index];
                        let value = &line[index + 1..];
                        map.insert(key.to_string(), value.to_string());
                    }
                }

                map.get("loc").map(|loc| {
                    let emoji = country_code_to_emoji(loc);
                    format!("{}{}", emoji, loc)
                })
            } else {
                None
            }
        }
        Err(_) => None,
    };

    // 2. 测试 ChatGPT iOS
    let url_ios = "https://ios.chat.openai.com/";
    let result_ios = client.get(url_ios).send().await;

    // 解析iOS测试结果
    let ios_status = match result_ios {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let body_lower = body.to_lowercase();
                if body_lower.contains("you may be connected to a disallowed isp") {
                    "Disallowed ISP"
                } else if body_lower.contains("request is not allowed. please try again later.") {
                    "Yes"
                } else if body_lower.contains("sorry, you have been blocked") {
                    "Blocked"
                } else {
                    "Failed"
                }
            } else {
                "Failed"
            }
        }
        Err(_) => "Failed",
    };

    // 3. 测试 ChatGPT Web
    let url_web = "https://api.openai.com/compliance/cookie_requirements";
    let result_web = client.get(url_web).send().await;

    // 解析Web测试结果
    let web_status = match result_web {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let body_lower = body.to_lowercase();
                if body_lower.contains("unsupported_country") {
                    "Unsupported Country/Region"
                } else {
                    "Yes"
                }
            } else {
                "Failed"
            }
        }
        Err(_) => "Failed",
    };

    // 添加iOS测试结果
    results.push(UnlockItem {
        name: "ChatGPT iOS".to_string(),
        status: ios_status.to_string(),
        region: region.clone(),
        check_time: Some(get_local_date_string()),
    });

    // 添加Web测试结果
    results.push(UnlockItem {
        name: "ChatGPT Web".to_string(),
        status: web_status.to_string(),
        region,
        check_time: Some(get_local_date_string()),
    });

    results
}

// 测试Gemini
async fn check_gemini(client: &Client) -> UnlockItem {
    let url = "https://gemini.google.com";

    let result = client.get(url).send().await;

    match result {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let is_ok = body.contains("45631641,null,true");
                let status = if is_ok { "Yes" } else { "No" };

                // 尝试提取国家代码
                let re = Regex::new(r#",2,1,200,"([A-Z]{3})""#).unwrap();
                let region = re.captures(&body).and_then(|caps| {
                    caps.get(1).map(|m| {
                        let country_code = m.as_str();
                        let emoji = country_code_to_emoji(country_code);
                        format!("{}{}", emoji, country_code)
                    })
                });

                UnlockItem {
                    name: "Gemini".to_string(),
                    status: status.to_string(),
                    region,
                    check_time: Some(get_local_date_string()),
                }
            } else {
                UnlockItem {
                    name: "Gemini".to_string(),
                    status: "Failed".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
        Err(_) => UnlockItem {
            name: "Gemini".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

// 测试 YouTube Premium
async fn check_youtube_premium(client: &Client) -> UnlockItem {
    let url = "https://www.youtube.com/premium";

    let result = client.get(url).send().await;

    match result {
        Ok(response) => {
            if let Ok(body) = response.text().await {
                let body_lower = body.to_lowercase();

                if body_lower.contains("youtube premium is not available in your country") {
                    UnlockItem {
                        name: "Youtube Premium".to_string(),
                        status: "No".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                } else if body_lower.contains("ad-free") {
                    // 尝试解析国家代码
                    let re = Regex::new(r#"id="country-code"[^>]*>([^<]+)<"#).unwrap();
                    let region = re.captures(&body).and_then(|caps| {
                        caps.get(1).map(|m| {
                            let country_code = m.as_str().trim();
                            let emoji = country_code_to_emoji(country_code);
                            format!("{}{}", emoji, country_code)
                        })
                    });

                    UnlockItem {
                        name: "Youtube Premium".to_string(),
                        status: "Yes".to_string(),
                        region,
                        check_time: Some(get_local_date_string()),
                    }
                } else {
                    UnlockItem {
                        name: "Youtube Premium".to_string(),
                        status: "Failed".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
            } else {
                UnlockItem {
                    name: "Youtube Premium".to_string(),
                    status: "Failed".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
        Err(_) => UnlockItem {
            name: "Youtube Premium".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

// 测试动画疯(Bahamut Anime)
async fn check_bahamut_anime(client: &Client) -> UnlockItem {
    // 创建带Cookie存储的客户端
    let cookie_store = Arc::new(reqwest::cookie::Jar::default());

    // 使用带Cookie的客户端
    let client_with_cookies = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .cookie_provider(Arc::clone(&cookie_store))
        .build()
        .unwrap_or_else(|_| client.clone());

    // 第一步：获取设备ID (会自动保存Cookie)
    let device_url = "https://ani.gamer.com.tw/ajax/getdeviceid.php";
    let device_id = match client_with_cookies.get(device_url).send().await {
        Ok(response) => {
            match response.text().await {
                Ok(text) => {
                    // 使用正则提取deviceid
                    let re = Regex::new(r#""deviceid"\s*:\s*"([^"]+)"#).unwrap();
                    re.captures(&text)
                        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
                        .unwrap_or_default()
                }
                Err(_) => String::new(),
            }
        }
        Err(_) => String::new(),
    };

    if device_id.is_empty() {
        return UnlockItem {
            name: "Bahamut Anime".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 第二步：使用设备ID检查访问权限 (使用相同的Cookie)
    let url = format!(
        "https://ani.gamer.com.tw/ajax/token.php?adID=89422&sn=37783&device={}",
        device_id
    );

    let token_result = match client_with_cookies.get(&url).send().await {
        Ok(response) => {
            match response.text().await {
                Ok(body) => {
                    // 检查内容是否可访问 - 更精确地匹配animeSn
                    if body.contains("animeSn") {
                        Some(body)
                    } else {
                        None
                    }
                }
                Err(_) => None,
            }
        }
        Err(_) => None,
    };

    // 如果无法获取token或不包含animeSn，表示不支持
    if token_result.is_none() {
        return UnlockItem {
            name: "Bahamut Anime".to_string(),
            status: "No".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 第三步：访问主页获取区域信息 (使用相同的Cookie)
    let region = match client_with_cookies
        .get("https://ani.gamer.com.tw/")
        .send()
        .await
    {
        Ok(response) => match response.text().await {
            Ok(body) => {
                let region_re = Regex::new(r#"data-geo="([^"]+)"#).unwrap();
                region_re
                    .captures(&body)
                    .and_then(|caps| caps.get(1))
                    .map(|m| {
                        let country_code = m.as_str();
                        let emoji = country_code_to_emoji(country_code);
                        format!("{}{}", emoji, country_code)
                    })
            }
            Err(_) => None,
        },
        Err(_) => None,
    };

    // 解锁成功
    UnlockItem {
        name: "Bahamut Anime".to_string(),
        status: "Yes".to_string(),
        region,
        check_time: Some(get_local_date_string()),
    }
}

// 测试 Netflix
async fn check_netflix(client: &Client) -> UnlockItem {
    // 首先尝试使用Fast.com API检测Netflix CDN区域
    let cdn_result = check_netflix_cdn(client).await;
    if cdn_result.status == "Yes" {
        return cdn_result;
    }

    // 如果CDN方法失败，尝试传统的内容检测方法
    // 测试两个 Netflix 内容 (LEGO Ninjago 和 Breaking Bad)
    let url1 = "https://www.netflix.com/title/81280792"; // LEGO Ninjago
    let url2 = "https://www.netflix.com/title/70143836"; // Breaking Bad

    // 创建简单的请求（不添加太多头部信息）
    let result1 = client
        .get(url1)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await;

    // 检查连接失败情况
    if let Err(e) = &result1 {
        eprintln!("Netflix请求错误: {}", e);
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 如果第一个请求成功，尝试第二个请求
    let result2 = client
        .get(url2)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await;

    if let Err(e) = &result2 {
        eprintln!("Netflix请求错误: {}", e);
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "Failed".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 获取状态码
    let status1 = result1.unwrap().status().as_u16();
    let status2 = result2.unwrap().status().as_u16();

    // 根据状态码判断解锁状况
    if status1 == 404 && status2 == 404 {
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "Originals Only".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    if status1 == 403 || status2 == 403 {
        return UnlockItem {
            name: "Netflix".to_string(),
            status: "No".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    if status1 == 200 || status1 == 301 || status2 == 200 || status2 == 301 {
        // 成功解锁，尝试获取地区信息
        // 使用Netflix测试内容获取区域
        let test_url = "https://www.netflix.com/title/80018499";
        match client
            .get(test_url)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
        {
            Ok(response) => {
                // 检查重定向位置
                if let Some(location) = response.headers().get("location") {
                    if let Ok(location_str) = location.to_str() {
                        // 解析位置获取区域
                        let parts: Vec<&str> = location_str.split('/').collect();
                        if parts.len() >= 4 {
                            let region_code = parts[3].split('-').next().unwrap_or("unknown");
                            let emoji = country_code_to_emoji(region_code);
                            return UnlockItem {
                                name: "Netflix".to_string(),
                                status: "Yes".to_string(),
                                region: Some(format!("{}{}", emoji, region_code)),
                                check_time: Some(get_local_date_string()),
                            };
                        }
                    }
                }
                // 如果没有重定向，假设是美国
                let emoji = country_code_to_emoji("us");
                UnlockItem {
                    name: "Netflix".to_string(),
                    status: "Yes".to_string(),
                    region: Some(format!("{}{}", emoji, "us")),
                    check_time: Some(get_local_date_string()),
                }
            }
            Err(e) => {
                eprintln!("获取Netflix区域信息失败: {}", e);
                UnlockItem {
                    name: "Netflix".to_string(),
                    status: "Yes (但无法获取区域)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                }
            }
        }
    } else {
        // 其他未知错误状态
        UnlockItem {
            name: "Netflix".to_string(),
            status: format!("Failed (状态码: {}_{}", status1, status2),
            region: None,
            check_time: Some(get_local_date_string()),
        }
    }
}

// 使用Fast.com API检测Netflix CDN区域
async fn check_netflix_cdn(client: &Client) -> UnlockItem {
    // Fast.com API URL
    let url = "https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=5";

    let result = client
        .get(url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await;

    match result {
        Ok(response) => {
            // 检查状态码
            if response.status().as_u16() == 403 {
                return UnlockItem {
                    name: "Netflix".to_string(),
                    status: "No (IP Banned By Netflix)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                };
            }

            // 尝试解析响应
            match response.json::<serde_json::Value>().await {
                Ok(data) => {
                    // 尝试从数据中提取区域信息
                    if let Some(targets) = data.get("targets").and_then(|t| t.as_array()) {
                        if !targets.is_empty() {
                            if let Some(location) = targets[0].get("location") {
                                if let Some(country) =
                                    location.get("country").and_then(|c| c.as_str())
                                {
                                    let emoji = country_code_to_emoji(country);
                                    return UnlockItem {
                                        name: "Netflix".to_string(),
                                        status: "Yes".to_string(),
                                        region: Some(format!("{}{}", emoji, country)),
                                        check_time: Some(get_local_date_string()),
                                    };
                                }
                            }
                        }
                    }

                    // 如果无法解析区域信息
                    UnlockItem {
                        name: "Netflix".to_string(),
                        status: "Unknown".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
                Err(e) => {
                    eprintln!("解析Fast.com API响应失败: {}", e);
                    UnlockItem {
                        name: "Netflix".to_string(),
                        status: "Failed (解析错误)".to_string(),
                        region: None,
                        check_time: Some(get_local_date_string()),
                    }
                }
            }
        }
        Err(e) => {
            eprintln!("Fast.com API请求失败: {}", e);
            UnlockItem {
                name: "Netflix".to_string(),
                status: "Failed (CDN API)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            }
        }
    }
}

// 测试 Disney+
async fn check_disney_plus(client: &Client) -> UnlockItem {
    // Disney+ 不支持 IPv6，但这里不做额外检查，因为我们使用的是系统默认网络

    // 第一步：获取 assertion
    let device_api_url = "https://disney.api.edge.bamgrid.com/devices";
    let auth_header =
        "Bearer ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84";

    let device_req_body = serde_json::json!({
        "deviceFamily": "browser",
        "applicationRuntime": "chrome",
        "deviceProfile": "windows",
        "attributes": {}
    });

    let device_result = client
        .post(device_api_url)
        .header("authorization", auth_header)
        .header("content-type", "application/json; charset=UTF-8")
        .json(&device_req_body)
        .send()
        .await;

    // 检查网络连接
    if device_result.is_err() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let device_response = device_result.unwrap();

    // 检查是否 403 错误
    if device_response.status().as_u16() == 403 {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No (IP Banned By Disney+)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let device_body = match device_response.text().await {
        Ok(body) => body,
        Err(_) => {
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Error: Cannot read response)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };

    // 提取 assertion
    let re = Regex::new(r#""assertion"\s*:\s*"([^"]+)"#).unwrap();
    let assertion = match re.captures(&device_body) {
        Some(caps) => caps.get(1).map(|m| m.as_str().to_string()),
        None => None,
    };

    if assertion.is_none() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Error: Cannot extract assertion)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 第二步：获取 token
    let token_url = "https://disney.api.edge.bamgrid.com/token";

    // 构建请求体 - 使用表单数据格式而非 JSON
    let assertion_str = assertion.unwrap();
    let token_body = [
        (
            "grant_type",
            "urn:ietf:params:oauth:grant-type:token-exchange",
        ),
        ("latitude", "0"),
        ("longitude", "0"),
        ("platform", "browser"),
        ("subject_token", assertion_str.as_str()),
        (
            "subject_token_type",
            "urn:bamtech:params:oauth:token-type:device",
        ),
    ];

    let token_result = client
        .post(token_url)
        .header("authorization", auth_header)
        .header("content-type", "application/x-www-form-urlencoded")
        .form(&token_body) // 使用 form 而不是 json
        .send()
        .await;

    if token_result.is_err() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let token_response = token_result.unwrap();
    let token_status = token_response.status();

    // 保存原始响应用于调试
    let token_body_text = match token_response.text().await {
        Ok(body) => body,
        Err(_) => {
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Failed (Error: Cannot read token response)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    };

    // 检查是否被禁止的地区
    if token_body_text.contains("forbidden-location") || token_body_text.contains("403 ERROR") {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No (IP Banned By Disney+)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 尝试解析 JSON
    let token_json: Result<serde_json::Value, _> = serde_json::from_str(&token_body_text);

    let refresh_token = match token_json {
        Ok(json) => json
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        Err(_) => {
            // 如果 JSON 解析失败，尝试使用正则表达式
            let refresh_token_re = Regex::new(r#""refresh_token"\s*:\s*"([^"]+)"#).unwrap();
            refresh_token_re
                .captures(&token_body_text)
                .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        }
    };

    // 如果仍然无法获取 refresh token
    if refresh_token.is_none() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: format!(
                "Failed (Error: Cannot extract refresh token, status: {}, response: {})",
                token_status.as_u16(),
                token_body_text.chars().take(100).collect::<String>() + "..."
            ),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 第三步：使用 GraphQL 获取地区信息
    let graphql_url = "https://disney.api.edge.bamgrid.com/graph/v1/device/graphql";

    // GraphQL API 通常接受 JSON 格式
    let graphql_payload = format!(
        r#"{{"query":"mutation refreshToken($input: RefreshTokenInput!) {{ refreshToken(refreshToken: $input) {{ activeSession {{ sessionId }} }} }}","variables":{{"input":{{"refreshToken":"{}"}}}}}}"#,
        refresh_token.unwrap()
    );

    let graphql_result = client
        .post(graphql_url)
        .header("authorization", auth_header)
        .header("content-type", "application/json")
        .body(graphql_payload)
        .send()
        .await;

    if graphql_result.is_err() {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 检查 Disney+ 主页的可用性
    let preview_check = client.get("https://disneyplus.com").send().await;

    let is_unavailable = match preview_check {
        Ok(response) => {
            let url = response.url().to_string();
            url.contains("preview") || url.contains("unavailable")
        }
        Err(_) => true,
    };

    // 解析 GraphQL 响应获取区域信息
    let graphql_response = graphql_result.unwrap();
    let graphql_status = graphql_response.status();
    let graphql_body_text = (graphql_response.text().await).unwrap_or_default();

    // 如果 GraphQL 响应为空或明显错误，尝试直接获取区域信息
    if graphql_body_text.is_empty() || graphql_status.as_u16() >= 400 {
        // 尝试直接从主页获取区域信息
        let region_from_main = match client.get("https://www.disneyplus.com/").send().await {
            Ok(response) => match response.text().await {
                Ok(body) => {
                    let region_re = Regex::new(r#"region"\s*:\s*"([^"]+)"#).unwrap();
                    region_re
                        .captures(&body)
                        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
                }
                Err(_) => None,
            },
            Err(_) => None,
        };

        if let Some(region) = region_from_main {
            let emoji = country_code_to_emoji(&region);
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Yes".to_string(),
                region: Some(format!("{}{} (from main page)", emoji, region)),
                check_time: Some(get_local_date_string()),
            };
        }

        // 如果主页也无法获取区域信息，返回详细错误
        if graphql_body_text.is_empty() {
            return UnlockItem {
                name: "Disney+".to_string(),
                status: format!(
                    "Failed (GraphQL error: empty response, status: {})",
                    graphql_status.as_u16()
                ),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        } else {
            return UnlockItem {
                name: "Disney+".to_string(),
                status: format!(
                    "Failed (GraphQL error: {}, status: {})",
                    graphql_body_text.chars().take(50).collect::<String>() + "...",
                    graphql_status.as_u16()
                ),
                region: None,
                check_time: Some(get_local_date_string()),
            };
        }
    }

    // 提取国家代码
    let region_re = Regex::new(r#""countryCode"\s*:\s*"([^"]+)"#).unwrap();
    let region_code = region_re
        .captures(&graphql_body_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()));

    // 提取支持状态
    let supported_re = Regex::new(r#""inSupportedLocation"\s*:\s*(false|true)"#).unwrap();
    let in_supported_location = supported_re
        .captures(&graphql_body_text)
        .and_then(|caps| caps.get(1).map(|m| m.as_str() == "true"));

    // 判断结果
    if region_code.is_none() {
        // 尝试直接从主页获取区域信息
        let region_from_main = match client.get("https://www.disneyplus.com/").send().await {
            Ok(response) => match response.text().await {
                Ok(body) => {
                    let region_re = Regex::new(r#"region"\s*:\s*"([^"]+)"#).unwrap();
                    region_re
                        .captures(&body)
                        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
                }
                Err(_) => None,
            },
            Err(_) => None,
        };

        if let Some(region) = region_from_main {
            let emoji = country_code_to_emoji(&region);
            return UnlockItem {
                name: "Disney+".to_string(),
                status: "Yes".to_string(),
                region: Some(format!("{}{} (from main page)", emoji, region)),
                check_time: Some(get_local_date_string()),
            };
        }

        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    let region = region_code.unwrap();

    // 判断日本地区
    if region == "JP" {
        let emoji = country_code_to_emoji("JP");
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "Yes".to_string(),
            region: Some(format!("{}{}", emoji, region)),
            check_time: Some(get_local_date_string()),
        };
    }

    // 判断不可用区域
    if is_unavailable {
        return UnlockItem {
            name: "Disney+".to_string(),
            status: "No".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 判断支持状态
    match in_supported_location {
        Some(false) => {
            let emoji = country_code_to_emoji(&region);
            UnlockItem {
                name: "Disney+".to_string(),
                status: "Soon".to_string(),
                region: Some(format!("{}{}（即将上线）", emoji, region)),
                check_time: Some(get_local_date_string()),
            }
        }
        Some(true) => {
            let emoji = country_code_to_emoji(&region);
            UnlockItem {
                name: "Disney+".to_string(),
                status: "Yes".to_string(),
                region: Some(format!("{}{}", emoji, region)),
                check_time: Some(get_local_date_string()),
            }
        }
        None => UnlockItem {
            name: "Disney+".to_string(),
            status: format!("Failed (Error: Unknown region status for {})", region),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

// 测试 Amazon Prime Video
async fn check_prime_video(client: &Client) -> UnlockItem {
    // 访问 Prime Video 主页
    let url = "https://www.primevideo.com";

    let result = client.get(url).send().await;

    // 检查网络连接
    if result.is_err() {
        return UnlockItem {
            name: "Prime Video".to_string(),
            status: "Failed (Network Connection)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        };
    }

    // 解析响应内容
    match result.unwrap().text().await {
        Ok(body) => {
            // 检查是否被地区限制
            let is_blocked = body.contains("isServiceRestricted");

            // 提取地区信息
            let region_re = Regex::new(r#""currentTerritory":"([^"]+)"#).unwrap();
            let region_code = region_re
                .captures(&body)
                .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()));

            // 判断结果
            if is_blocked {
                return UnlockItem {
                    name: "Prime Video".to_string(),
                    status: "No (Service Not Available)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                };
            }

            if let Some(region) = region_code {
                let emoji = country_code_to_emoji(&region);
                return UnlockItem {
                    name: "Prime Video".to_string(),
                    status: "Yes".to_string(),
                    region: Some(format!("{}{}", emoji, region)),
                    check_time: Some(get_local_date_string()),
                };
            }

            // 页面解析错误
            if !is_blocked && region_code.is_none() {
                return UnlockItem {
                    name: "Prime Video".to_string(),
                    status: "Failed (Error: PAGE ERROR)".to_string(),
                    region: None,
                    check_time: Some(get_local_date_string()),
                };
            }

            // 未知错误
            UnlockItem {
                name: "Prime Video".to_string(),
                status: "Failed (Error: Unknown Region)".to_string(),
                region: None,
                check_time: Some(get_local_date_string()),
            }
        }
        Err(_) => UnlockItem {
            name: "Prime Video".to_string(),
            status: "Failed (Error: Cannot read response)".to_string(),
            region: None,
            check_time: Some(get_local_date_string()),
        },
    }
}

// 获取所有解锁项目的列表
#[command]
pub async fn get_unlock_items() -> Result<Vec<UnlockItem>, String> {
    let items = vec![
        UnlockItem {
            name: "哔哩哔哩大陆".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "哔哩哔哩港澳台".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "ChatGPT iOS".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "ChatGPT Web".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "Gemini".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "Youtube Premium".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "Bahamut Anime".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "Netflix".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "Disney+".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
        UnlockItem {
            name: "Prime Video".to_string(),
            status: "Pending".to_string(),
            region: None,
            check_time: None,
        },
    ];

    Ok(items)
}

// 开始检测流媒体解锁状态
#[command]
pub async fn check_media_unlock() -> Result<Vec<UnlockItem>, String> {
    // 创建一个http客户端，增加更多配置
    let client = match Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30)) // 全局超时设置
        .danger_accept_invalid_certs(true) // 接受无效证书，防止SSL错误
        .danger_accept_invalid_hostnames(true) // 接受无效主机名
        .tcp_keepalive(std::time::Duration::from_secs(60)) // TCP keepalive
        .connection_verbose(true) // 详细连接信息
        .build() {
        Ok(client) => client,
        Err(e) => return Err(format!("创建HTTP客户端失败: {}", e)),
    };

    // 创建共享的结果集
    let results = Arc::new(Mutex::new(Vec::new()));

    // 创建一个任务集，用于并行处理所有检测
    let mut tasks = JoinSet::new();

    // 共享的Client实例
    let client_arc = Arc::new(client);

    // 添加哔哩哔哩大陆检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_bilibili_china_mainland(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 添加哔哩哔哩港澳台检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_bilibili_hk_mc_tw(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 添加合并的ChatGPT检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let chatgpt_results = check_chatgpt_combined(&client).await;
            let mut results = results.lock().await;
            results.extend(chatgpt_results);
        });
    }

    // 添加Gemini检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_gemini(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 添加YouTube Premium检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_youtube_premium(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 添加动画疯检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_bahamut_anime(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 添加 Netflix 检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_netflix(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 添加 Disney+ 检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_disney_plus(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 添加 Prime Video 检测任务
    {
        let client = client_arc.clone();
        let results = results.clone();
        tasks.spawn(async move {
            let result = check_prime_video(&client).await;
            let mut results = results.lock().await;
            results.push(result);
        });
    }

    // 等待所有任务完成
    while let Some(res) = tasks.join_next().await {
        if let Err(e) = res {
            eprintln!("任务执行失败: {}", e);
        }
    }

    // 获取所有结果
    let results = Arc::try_unwrap(results)
        .expect("无法获取结果，可能仍有引用存在")
        .into_inner();

    Ok(results)
}
