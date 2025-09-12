mod config;

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::json;

    #[test]
    fn default_config() {
        let default = crate::config::RawConfig::default();
        let mut file = std::fs::File::create("config.yaml").unwrap();
        file.write_all(serde_yaml_ng::to_string(&default).unwrap().as_bytes())
            .unwrap();
        file.flush().unwrap();
    }

    #[test]
    fn test_json() {
        let data = json!({
            "proxies": [
                { "name": "proxy1", "type": "http" },
                { "name": "proxy2", "type": "socks5" }
            ]
        });

        if let Some(name) = data.pointer("/proxies/0/name") {
            println!("{}", name); // "proxy1"
        }
    }
}
