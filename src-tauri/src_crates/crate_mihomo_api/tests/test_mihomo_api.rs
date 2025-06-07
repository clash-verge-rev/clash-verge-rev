use reqwest::header::HeaderMap;

#[test]
fn test_mihomo_manager_init() {
    let _ = mihomo_api::MihomoManager::new("url".into(), HeaderMap::new());
    assert_eq!(true, true);
}
