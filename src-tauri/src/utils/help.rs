use crate::error::AppResult;
use crate::{any_err, config::Config, error::AppError};
use nanoid::nanoid;
use serde::{Serialize, de::DeserializeOwned};
use serde_yaml::{Mapping, Value};
use std::{fs, io, net::TcpListener, path::PathBuf, str::FromStr};

/// read data from yaml as struct T
pub fn read_yaml<T: DeserializeOwned>(path: &PathBuf) -> AppResult<T> {
    if !path.exists() {
        return Err(AppError::Io(io::Error::new(
            io::ErrorKind::NotFound,
            format!("file not found \"{}\"", path.display()),
        )));
    }

    let yaml_str = fs::read_to_string(path).map_err(|_| any_err!("failed to read the file \"{}\"", path.display()))?;

    let res = serde_yaml::from_str::<T>(&yaml_str)
        .map_err(|_| any_err!("failed to read the file with yaml format \"{}\"", path.display()))?;
    Ok(res)
}

/// read mapping from yaml fix #165
pub fn read_merge_mapping(path: &PathBuf) -> AppResult<Mapping> {
    let mut val: Value = read_yaml(path)?;
    if val.is_null() {
        return Ok(Mapping::new());
    }
    val.apply_merge()
        .map_err(|_| any_err!("failed to apply merge \"{}\"", path.display()))?;
    let mapping = val
        .as_mapping()
        .ok_or(any_err!("failed to transform to yaml mapping \"{}\"", path.display()))?
        .to_owned();
    Ok(mapping)
}

/// save the data to the file
/// can set `prefix` string to add some comments
pub fn save_yaml<T: Serialize>(path: &PathBuf, data: &T, prefix: Option<&str>) -> AppResult<()> {
    let data_str = serde_yaml::to_string(data)?;

    let yaml_str = match prefix {
        Some(prefix) => format!("{prefix}\n\n{data_str}"),
        None => data_str,
    };

    let path_str = path.as_os_str().to_string_lossy().to_string();
    fs::write(path, yaml_str.as_bytes()).map_err(|_| any_err!("failed to save file \"{path_str}\""))?;
    Ok(())
}

pub fn deep_merge(dest: &mut Value, src: &Value) {
    match (dest, src) {
        (Value::Mapping(dest), Value::Mapping(src)) => {
            for (k, v) in src {
                deep_merge(dest.entry(k.clone()).or_insert(Value::Null), v);
            }
        }
        (dest, src) => *dest = src.clone(),
    }
}

const ALPHABET: [char; 62] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

/// generate the uid
pub fn get_uid(prefix: &str) -> String {
    let id = nanoid!(11, &ALPHABET);
    format!("{prefix}{id}")
}

/// parse the string
/// xxx=123123; => 123123
pub fn parse_str<T: FromStr>(target: &str, key: &str) -> Option<T> {
    target.split(';').map(str::trim).find_map(|s| {
        let mut parts = s.splitn(2, '=');
        match (parts.next(), parts.next()) {
            (Some(k), Some(v)) if k == key => v.parse::<T>().ok(),
            _ => None,
        }
    })
}

/// get the last part of the url, if not found, return empty string
pub fn get_last_part_and_decode(url: &str) -> Option<String> {
    let path = url.split('?').next().unwrap_or_default(); // Splits URL and takes the path part
    let segments = path.split('/').collect::<Vec<&str>>();
    let last_segment = segments.last()?;

    Some(
        percent_encoding::percent_decode_str(last_segment)
            .decode_utf8_lossy()
            .to_string(),
    )
}

/// open file
/// use vscode by default
#[cfg(not(target_os = "windows"))]
pub fn open_file(app: tauri::AppHandle, path: PathBuf) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;

    let _ = app
        .opener()
        .open_path(path.to_string_lossy(), Some("code"))
        .map_err(|_| {
            tracing::info!("open file by vscode err, use system default to open it");
            app.opener().open_path(path.to_string_lossy(), None::<&str>)
        });
    Ok(())
}

// open file
// use vscode by default
#[cfg(target_os = "windows")]
pub fn open_file(app: tauri::AppHandle, path: PathBuf) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    use tauri_plugin_shell::ShellExt;

    let shell = app.shell();
    let output = tauri::async_runtime::block_on(async {
        shell
            .command("cmd")
            .args(["/c", "code", &path.to_string_lossy()])
            .output()
            .await
    });
    match output {
        Ok(output) => {
            if !output.status.success() {
                tracing::info!("open file by vscode err, use system default to open it");
                let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
            }
        }
        Err(_) => {
            tracing::info!("open file by vscode err, use system default to open it");
            let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
        }
    }
    Ok(())
}

pub fn parse_check_output(log: &str) -> &str {
    let t = log.find("time=");
    let m = log.find("msg=");
    let mr = log.rfind('"');

    if let (Some(_), Some(m), Some(mr)) = (t, m, mr) {
        let e = match log.find("level=error msg=") {
            Some(e) => e + 17,
            None => m + 5,
        };

        if mr > m {
            return &log[e..mr];
        }
    }

    let l = log.find("error=");
    let r = log.find("path=").or(Some(log.len()));

    if let (Some(l), Some(r)) = (l, r) {
        return &log[(l + 6)..(r - 1)];
    }

    log
}

pub fn local_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

pub fn find_unused_port() -> AppResult<u16> {
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => {
            let port = listener.local_addr()?.port();
            Ok(port)
        }
        Err(_) => {
            let port = Config::clash().latest().get_mixed_port();
            tracing::warn!("use default port: {port}");
            Ok(port)
        }
    }
}

#[macro_export]
macro_rules! error {
    ($result: expr) => {
        tracing::error!("{}", $result);
    };
}

#[macro_export]
macro_rules! log_err {
    ($result: expr) => {
        if let Err(err) = $result {
            tracing::error!("{err}");
        }
    };

    ($result: expr, $err_str: expr) => {
        if let Err(_) = $result {
            tracing::error!("{}", $err_str);
        }
    };
}

#[macro_export]
macro_rules! trace_err {
    ($result: expr, $err_str: expr) => {
        if let Err(err) = $result {
            tracing::trace!("{}, err {}", $err_str, err);
        }
    };
}

/// wrap the anyhow error
/// transform the error to String
// #[macro_export]
// macro_rules! wrap_err {
//     ($stat: expr) => {
//         match $stat {
//             Ok(a) => Ok(a),
//             Err(err) => {
//                 tracing::error!("{}", err.to_string());
//                 Err(format!("{}", err.to_string()))
//             }
//         }
//     };
//     ($stat: expr, $err_str: expr) => {
//         match $stat {
//             Ok(a) => Ok(a),
//             Err(err) => {
//                 tracing::error!("{}, {}", $err_str, err.to_string());
//                 Err(format!("{}, {}", $err_str, err.to_string()))
//             }
//         }
//     };
// }

/// return the string literal error
// #[macro_export]
// macro_rules! ret_err {
//     ($($arg: tt)*) => {
//         return Err(format!($($arg)*))
//     };
// }

#[test]
fn test_parse_check_output() {
    let str1 = r#"xxxx\n time="2022-11-18T20:42:58+08:00" level=error msg="proxy 0: 'alpn' expected type 'string', got unconvertible type '[]interface {}'""#;
    let str2 = r#"20:43:49 ERR [Config] configuration file test failed error=proxy 0: unsupported proxy type: hysteria path=xxx"#;
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

#[test]
fn test_parse_value() {
    let test_1 = "upload=111; download=2222; total=3333; expire=444";
    let test_2 = "attachment; filename=Clash.yaml";

    assert_eq!(parse_str::<usize>(test_1, "upload").unwrap(), 111);
    assert_eq!(parse_str::<usize>(test_1, "download").unwrap(), 2222);
    assert_eq!(parse_str::<usize>(test_1, "total").unwrap(), 3333);
    assert_eq!(parse_str::<usize>(test_1, "expire").unwrap(), 444);
    assert_eq!(parse_str::<String>(test_2, "filename").unwrap(), format!("Clash.yaml"));

    assert_eq!(parse_str::<usize>(test_1, "aaa"), None);
    assert_eq!(parse_str::<usize>(test_1, "upload1"), None);
    assert_eq!(parse_str::<usize>(test_1, "expire1"), None);
    assert_eq!(parse_str::<usize>(test_2, "attachment"), None);
}
