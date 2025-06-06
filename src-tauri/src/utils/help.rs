use crate::{enhance::seq::SeqMap, logging, utils::logging::Type};
use anyhow::{anyhow, bail, Context, Result};
use nanoid::nanoid;
use serde::{de::DeserializeOwned, Serialize};
use serde_yaml::Mapping;
use std::{fs, path::PathBuf, str::FromStr};

/// read data from yaml as struct T
pub fn read_yaml<T: DeserializeOwned>(path: &PathBuf) -> Result<T> {
    if !path.exists() {
        bail!("file not found \"{}\"", path.display());
    }

    let yaml_str = fs::read_to_string(path)
        .with_context(|| format!("failed to read the file \"{}\"", path.display()))?;

    serde_yaml::from_str::<T>(&yaml_str).with_context(|| {
        format!(
            "failed to read the file with yaml format \"{}\"",
            path.display()
        )
    })
}

/// read mapping from yaml
pub fn read_mapping(path: &PathBuf) -> Result<Mapping> {
    if !path.exists() {
        bail!("file not found \"{}\"", path.display());
    }

    let yaml_str = fs::read_to_string(path)
        .with_context(|| format!("failed to read the file \"{}\"", path.display()))?;

    // YAML语法检查
    match serde_yaml::from_str::<serde_yaml::Value>(&yaml_str) {
        Ok(mut val) => {
            val.apply_merge()
                .with_context(|| format!("failed to apply merge \"{}\"", path.display()))?;

            Ok(val
                .as_mapping()
                .ok_or(anyhow!(
                    "failed to transform to yaml mapping \"{}\"",
                    path.display()
                ))?
                .to_owned())
        }
        Err(err) => {
            let error_msg = format!("YAML syntax error in {}: {}", path.display(), err);
            logging!(error, Type::Config, true, "{}", error_msg);

            crate::core::handle::Handle::notice_message(
                "config_validate::yaml_syntax_error",
                &error_msg,
            );

            bail!("YAML syntax error: {}", err)
        }
    }
}

/// read mapping from yaml fix #165
pub fn read_seq_map(path: &PathBuf) -> Result<SeqMap> {
    let val: SeqMap = read_yaml(path)?;

    Ok(val)
}

/// save the data to the file
/// can set `prefix` string to add some comments
pub fn save_yaml<T: Serialize>(path: &PathBuf, data: &T, prefix: Option<&str>) -> Result<()> {
    let data_str = serde_yaml::to_string(data)?;

    let yaml_str = match prefix {
        Some(prefix) => format!("{prefix}\n\n{data_str}"),
        None => data_str,
    };

    let path_str = path.as_os_str().to_string_lossy().to_string();
    fs::write(path, yaml_str.as_bytes())
        .with_context(|| format!("failed to save file \"{path_str}\""))
}

const ALPHABET: [char; 62] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i',
    'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B',
    'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U',
    'V', 'W', 'X', 'Y', 'Z',
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
    let path = url.split('?').next().unwrap_or(""); // Splits URL and takes the path part
    let segments: Vec<&str> = path.split('/').collect();
    let last_segment = segments.last()?;

    Some(
        percent_encoding::percent_decode_str(last_segment)
            .decode_utf8_lossy()
            .to_string(),
    )
}

/// open file
pub fn open_file(_: tauri::AppHandle, path: PathBuf) -> Result<()> {
    open::that_detached(path.as_os_str())?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn is_monochrome_image_from_bytes(data: &[u8]) -> anyhow::Result<bool> {
    let img = image::load_from_memory(data)?;
    let rgb_img = img.to_rgb8();

    for pixel in rgb_img.pixels() {
        if pixel[0] != pixel[1] || pixel[1] != pixel[2] {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(target_os = "linux")]
pub fn linux_elevator() -> String {
    use std::process::Command;
    match Command::new("which").arg("pkexec").output() {
        Ok(output) => {
            if !output.stdout.is_empty() {
                // Convert the output to a string slice
                if let Ok(path) = std::str::from_utf8(&output.stdout) {
                    path.trim().to_string()
                } else {
                    "sudo".to_string()
                }
            } else {
                "sudo".to_string()
            }
        }
        Err(_) => "sudo".to_string(),
    }
}

/// return the string literal error
#[macro_export]
macro_rules! ret_err {
    ($str: expr) => {
        return Err($str.into())
    };
}

#[macro_export]
macro_rules! t {
    ($en:expr, $zh:expr, $use_zh:expr) => {
        if $use_zh {
            $zh
        } else {
            $en
        }
    };
}

/// 将字节数转换为可读的流量字符串
/// 支持 B/s、KB/s、MB/s、GB/s 的自动转换
///
/// # Examples
/// ```not_run
/// format_bytes_speed(1000) // returns "1000B/s"
/// format_bytes_speed(1024) // returns "1.0KB/s"
/// format_bytes_speed(1024 * 1024) // returns "1.0MB/s"
/// ```
/// ```
#[cfg(target_os = "macos")]
pub fn format_bytes_speed(speed: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut size = speed as f64;
    let mut unit_index = 0;

    while size >= 1000.0 && unit_index < UNITS.len() - 1 {
        size /= 1024.0;
        unit_index += 1;
    }

    format!("{:.1}{}/s", size, UNITS[unit_index])
}

#[cfg(target_os = "macos")]
#[test]
fn test_format_bytes_speed() {
    assert_eq!(format_bytes_speed(0), "0.0B/s");
    assert_eq!(format_bytes_speed(1023), "1.0KB/s");
    assert_eq!(format_bytes_speed(1024), "1.0KB/s");
    assert_eq!(format_bytes_speed(1024 * 1024), "1.0MB/s");
    assert_eq!(format_bytes_speed(1024 * 1024 * 1024), "1.0GB/s");
    assert_eq!(format_bytes_speed(1024 * 500), "500.0KB/s");
    assert_eq!(format_bytes_speed(1024 * 1024 * 2), "2.0MB/s");
}
