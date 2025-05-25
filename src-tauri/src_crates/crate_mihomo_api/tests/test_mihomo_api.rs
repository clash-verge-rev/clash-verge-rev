use mihomo_api;
use reqwest::header::HeaderMap;

#[test]
fn test_mihomo_manager_init() {
    let manager = mihomo_api::MihomoManager::new("url".into(), HeaderMap::new());
    assert_eq!(manager.get_proxies(), serde_json::Value::Null);
    assert_eq!(manager.get_providers_proxies(), serde_json::Value::Null);
}

#[tokio::test]
async fn test_refresh_proxies() {
    let manager = mihomo_api::MihomoManager::new("http://127.0.0.1:9097".into(), HeaderMap::new());
    let manager = manager.refresh_proxies().await.unwrap();
    let proxies = manager.get_proxies();
    let providers = manager.get_providers_proxies();
    assert_ne!(proxies, serde_json::Value::Null);
    assert_eq!(providers, serde_json::Value::Null);
}

#[tokio::test]
async fn test_refresh_providers_proxies() {
    let manager = mihomo_api::MihomoManager::new("http://127.0.0.1:9097".into(), HeaderMap::new());
    let manager = manager.refresh_providers_proxies().await.unwrap();
    let proxies = manager.get_proxies();
    let providers = manager.get_providers_proxies();
    assert_eq!(proxies, serde_json::Value::Null);
    assert_ne!(providers, serde_json::Value::Null);
}
