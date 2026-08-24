use crate::{config::with_encryption, enhance::seq::SeqMap};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_logging::{Type, logging};
use nanoid::nanoid;
use scopeguard::{ScopeGuard, guard};
use serde::{Serialize, de::DeserializeOwned};
use serde_yaml_ng::{Mapping, Value};
use std::{
    path::{Path, PathBuf},
    str::FromStr,
};
use tokio::io::AsyncWriteExt as _;

pub async fn read_yaml<T: DeserializeOwned>(path: &PathBuf) -> Result<T> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        bail!("file not found \"{}\"", path.display());
    }

    let yaml_str = tokio::fs::read_to_string(path).await?;

    Ok(with_encryption(|| async { serde_yaml_ng::from_str::<T>(&yaml_str) }).await?)
}

pub async fn read_mapping(path: &PathBuf) -> Result<Mapping> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        bail!("file not found \"{}\"", path.display());
    }

    let yaml_str = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("failed to read the file \"{}\"", path.display()))?;

    match serde_yaml_ng::from_str::<serde_yaml_ng::Value>(&yaml_str) {
        Ok(mut val) => {
            val.apply_merge()
                .with_context(|| format!("failed to apply merge \"{}\"", path.display()))?;

            match val {
                Value::Mapping(map) => Ok(map),
                _ => Err(anyhow!("failed to transform to yaml mapping \"{}\"", path.display())),
            }
        }
        Err(err) => {
            let error_msg = format!("YAML syntax error in {}: {}", path.display(), err);
            logging!(error, Type::Config, "{}", error_msg);

            crate::core::handle::Handle::notice_message("config_validate::yaml_syntax_error", &error_msg);

            bail!("YAML syntax error: {}", err)
        }
    }
}

pub async fn read_seq_map(path: &PathBuf) -> Result<SeqMap> {
    read_yaml(path).await
}

pub async fn save_yaml<T: Serialize + Sync>(path: &Path, data: &T, prefix: Option<&str>) -> Result<()> {
    let data_str = with_encryption(|| async { serde_yaml_ng::to_string(data) }).await?;

    let yaml_str = match prefix {
        Some(prefix) => format!("{prefix}\n\n{data_str}"),
        None => data_str,
    };

    let (temporary, file) = loop {
        let temporary = path.with_extension(format!("tmp-{}-{}", std::process::id(), nanoid!()));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(error).with_context(|| {
                    format!(
                        "failed to create temporary file \"{}\" for \"{}\"",
                        temporary.display(),
                        path.display()
                    )
                });
            }
        }
    };

    let temporary = guard(temporary, |path| {
        let _ = std::fs::remove_file(path);
    });
    let mut file = tokio::fs::File::from_std(file);
    file.write_all(yaml_str.as_bytes())
        .await
        .with_context(|| format!("failed to write temporary file for \"{}\"", path.display()))?;
    file.flush()
        .await
        .with_context(|| format!("failed to flush temporary file for \"{}\"", path.display()))?;
    drop(file);

    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.file_type().is_file() => {
            tokio::fs::set_permissions(temporary.as_path(), metadata.permissions())
                .await
                .with_context(|| format!("failed to preserve permissions for \"{}\"", path.display()))?;
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect file \"{}\"", path.display()));
        }
    }

    std::fs::rename(temporary.as_path(), path)
        .with_context(|| format!("failed to replace file \"{}\"", path.display()))?;
    let _ = ScopeGuard::into_inner(temporary);
    Ok(())
}

const ALPHABET: [char; 62] = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

pub fn get_uid(prefix: &str) -> String {
    let id = nanoid!(11, &ALPHABET);
    format!("{prefix}{id}")
}

pub fn parse_str<T: FromStr>(target: &str, key: &str) -> Option<T> {
    target.split(';').map(str::trim).find_map(|s| {
        let mut parts = s.splitn(2, '=');
        match (parts.next(), parts.next()) {
            (Some(k), Some(v)) if k == key => v.parse::<T>().ok(),
            _ => None,
        }
    })
}

/// Masks query values and token-like path segments for logging.
pub fn mask_url(url: &str) -> String {
    let (path_part, query_part) = match url.find('?') {
        Some(pos) => (&url[..pos], Some(&url[pos + 1..])),
        None => (url, None),
    };

    let host_end = path_part
        .find("://")
        .and_then(|scheme_end| {
            path_part[scheme_end + 3..]
                .find('/')
                .map(|slash| scheme_end + 3 + slash)
        })
        .unwrap_or(path_part.len());

    let scheme_and_host = &path_part[..host_end];
    let path = &path_part[host_end..]; // starts with '/' or empty

    let mut result = scheme_and_host.to_owned();

    if !path.is_empty() {
        let masked: Vec<&str> = path
            .split('/')
            .map(|seg| if seg.len() > 16 { "***" } else { seg })
            .collect();
        result.push_str(&masked.join("/"));
    }

    if let Some(query) = query_part {
        result.push('?');
        let masked_query: Vec<String> = query
            .split('&')
            .map(|param| match param.find('=') {
                Some(eq) => format!("{}=***", &param[..eq]),
                None => param.to_owned(),
            })
            .collect();
        result.push_str(&masked_query.join("&"));
    }

    result
}

/// Masks every HTTP(S) URL embedded in a log string while preserving surrounding text.
pub fn mask_err(err: &str) -> String {
    let mut result = String::with_capacity(err.len());
    let mut remaining = err;

    loop {
        let http = remaining.find("http://");
        let https = remaining.find("https://");
        let start = match (http, https) {
            (None, None) => {
                result.push_str(remaining);
                break;
            }
            (Some(a), None) | (None, Some(a)) => a,
            (Some(a), Some(b)) => a.min(b),
        };

        result.push_str(&remaining[..start]);
        remaining = &remaining[start..];

        let url_end = remaining
            .find(|c: char| c.is_whitespace() || matches!(c, ')' | ']' | '"' | '\''))
            .unwrap_or(remaining.len());

        result.push_str(&mask_url(&remaining[..url_end]));
        remaining = &remaining[url_end..];
    }

    result
}

pub fn get_last_part_and_decode(url: &str) -> Option<String> {
    let path = url.split('?').next().unwrap_or("");
    let segments: Vec<&str> = path.split('/').collect();
    let last_segment = segments.last()?;

    Some(
        percent_encoding::percent_decode_str(last_segment)
            .decode_utf8_lossy()
            .to_string(),
    )
}

pub fn open_file(path: PathBuf) -> Result<()> {
    open::that_detached(path.as_os_str())?;
    Ok(())
}

pub fn open_latest_log(path: PathBuf) -> Result<()> {
    #[cfg(target_os = "windows")]
    let path = snapshot_path(&path)?;
    open_file(path)
}

pub fn open_app_latest_log() -> Result<()> {
    let path = crate::utils::dirs::app_latest_log()?;
    open_latest_log(path)
}

pub async fn open_core_latest_log() -> Result<()> {
    let path = if matches!(
        *crate::core::CoreManager::global().get_running_mode(),
        crate::core::manager::RunningMode::Service
    ) {
        let path = crate::utils::dirs::service_log_dir()?.join("service_latest.log");
        let snapshot = crate::core::service::get_clash_log_snapshot_by_service().await?;
        tokio::fs::write(&path, snapshot).await?;
        path
    } else {
        crate::utils::dirs::clash_latest_log()?
    };
    open_latest_log(path)
}

#[cfg(target_os = "linux")]
pub fn linux_elevator() -> String {
    use std::process::Command;
    match Command::new("which").arg("pkexec").output() {
        Ok(output) => {
            if !output.stdout.is_empty() {
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

#[cfg(target_os = "windows")]
pub fn snapshot_path(original_path: &Path) -> Result<PathBuf> {
    let temp_dir = original_path
        .parent()
        .ok_or_else(|| anyhow!("Invalid log path"))?
        .join("temp");

    std::fs::create_dir_all(&temp_dir).map_err(|error| {
        anyhow!(
            "failed to create log snapshot directory {}: {error}",
            temp_dir.display()
        )
    })?;

    let temp_path = temp_dir.join(format!(
        "{}_{}.log",
        original_path.file_stem().unwrap_or_default().to_string_lossy(),
        chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")
    ));

    std::fs::copy(original_path, &temp_path).map_err(|error| {
        anyhow!(
            "failed to copy log snapshot from {} to {}: {error}",
            original_path.display(),
            temp_path.display()
        )
    })?;

    Ok(temp_path)
}
