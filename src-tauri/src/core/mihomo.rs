use crate::config::Config;
use anyhow::{Ok, Result};
use mihomo_api::{Mihomo, MihomoBuilder};
use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct MihomoClientManager {
    mihomo: Arc<Mutex<Mihomo>>,
}

impl MihomoClientManager {
    pub fn global() -> &'static MihomoClientManager {
        static MIHOMO_MANAGER_CLIENT: OnceCell<MihomoClientManager> = OnceCell::new();
        MIHOMO_MANAGER_CLIENT.get_or_init(|| MihomoClientManager {
            mihomo: Arc::new(Mutex::new(MihomoBuilder::new().build().unwrap())),
        })
    }

    pub fn init(&self) -> Result<()> {
        let clash = { Config::clash().latest().get_client_info() };
        let (external_host, external_port) = clash
            .server
            .split_once(":")
            .expect("failed to get external host and port");
        let secret = clash.secret.unwrap_or_default();
        let mut mihomo = self.mihomo.lock();
        mihomo.set_external_host(external_host);
        mihomo.set_external_port(external_port.parse().unwrap());
        mihomo.set_secret(secret);
        Ok(())
    }

    // TODO: 使用 mihomo() 方法是无法改变 mihomo 的 external_host、external_port、secret 的值,
    //       因为 mihomo 方法返回的是一个克隆的对象，不是原来对象本身
    pub fn mihomo(&self) -> Mihomo {
        self.mihomo.lock().clone()
    }

    pub fn set_external_controller(&self, external_controller: &str) {
        let mut mihomo = self.mihomo.lock();
        let (host, port) = external_controller.split_once(':').unwrap();
        mihomo.set_external_host(host);
        mihomo.set_external_port(port.parse().unwrap());
    }

    pub fn set_secret(&self, secret: &str) {
        let mut mihomo = self.mihomo.lock();
        mihomo.set_secret(secret);
    }
}

/// 缩短clash的日志
#[allow(dead_code)]
pub fn parse_log(log: String) -> String {
    if log.starts_with("time=") && log.len() > 33 {
        return (log[33..]).to_owned();
    }
    if log.len() > 9 {
        return (log[9..]).to_owned();
    }
    log
}

/// 缩短clash -t的错误输出
/// 仅适配 clash p核 8-26、clash meta 1.13.1
pub fn parse_check_output(log: String) -> String {
    let t = log.find("time=");
    let m = log.find("msg=");
    let mr = log.rfind('"');

    if let (Some(_), Some(m), Some(mr)) = (t, m, mr) {
        let e = match log.find("level=error msg=") {
            Some(e) => e + 17,
            None => m + 5,
        };

        if mr > m {
            return (log[e..mr]).to_owned();
        }
    }

    let l = log.find("error=");
    let r = log.find("path=").or(Some(log.len()));

    if let (Some(l), Some(r)) = (l, r) {
        return (log[(l + 6)..(r - 1)]).to_owned();
    }

    log
}

#[test]
fn test_parse_check_output() {
    let str1 = r#"xxxx\n time="2022-11-18T20:42:58+08:00" level=error msg="proxy 0: 'alpn' expected type 'string', got unconvertible type '[]interface {}'""#;
    let str2 = r#"20:43:49 ERR [Config] configuration file test failed error=proxy 0: unsupport proxy type: hysteria path=xxx"#;
    let str3 = r#"
    "time="2022-11-18T21:38:01+08:00" level=info msg="Start initial configuration in progress"
    time="2022-11-18T21:38:01+08:00" level=error msg="proxy 0: 'alpn' expected type 'string', got unconvertible type '[]interface {}'"
    configuration file xxx\n
    "#;

    let res1 = parse_check_output(str1.into());
    let res2 = parse_check_output(str2.into());
    let res3 = parse_check_output(str3.into());

    println!("res1: {res1}");
    println!("res2: {res2}");
    println!("res3: {res3}");

    assert_eq!(res1, res3);
}
