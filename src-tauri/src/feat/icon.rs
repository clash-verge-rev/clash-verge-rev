use crate::{
    cmd::{CmdResult, StringifyErr as _},
    utils::dirs::{self, PathBufExec as _},
};
use clash_verge_logging::{Type, logging};
use smartstring::alias::String;
use std::path::{Component, Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt as _;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct IconInfo {
    name: String,
    previous_t: String,
    current_t: String,
}

fn normalize_icon_segment(name: &str) -> CmdResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("invalid icon cache file name".into());
    }

    let mut components = Path::new(trimmed).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(trimmed.into()),
        _ => Err("invalid icon cache file name".into()),
    }
}

fn ensure_icon_cache_target(icon_cache_dir: &Path, file_name: &str) -> CmdResult<PathBuf> {
    let icon_path = icon_cache_dir.join(file_name);
    let is_direct_child =
        icon_path.parent().is_some_and(|parent| parent == icon_cache_dir) && icon_path.starts_with(icon_cache_dir);

    if !is_direct_child {
        return Err("invalid icon cache file name".into());
    }

    Ok(icon_path)
}

fn normalized_text_prefix(content: &[u8]) -> std::string::String {
    let content = content.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(content);
    let start = content
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(content.len());
    let end = content.len().min(start.saturating_add(2048));
    let prefix = &content[start..end];
    std::string::String::from_utf8_lossy(prefix).to_ascii_lowercase()
}

fn looks_like_html(content: &[u8]) -> bool {
    let prefix = normalized_text_prefix(content);
    prefix.starts_with("<!doctype html") || prefix.starts_with("<html") || prefix.starts_with("<head")
}

fn looks_like_svg(content: &[u8]) -> bool {
    let prefix = normalized_text_prefix(content);
    prefix.starts_with("<svg")
        || ((prefix.starts_with("<?xml") || prefix.starts_with("<!doctype svg")) && prefix.contains("<svg"))
}

fn is_supported_icon_content(content: &[u8]) -> bool {
    if looks_like_html(content) {
        return false;
    }

    tauri::image::Image::from_bytes(content).is_ok() || looks_like_svg(content)
}

pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    let icon_cache_dir = dirs::app_home_dir().stringify_err()?.join("icons").join("cache");
    let icon_name = normalize_icon_segment(name.as_str())?;
    let icon_path = ensure_icon_cache_target(&icon_cache_dir, icon_name.as_str())?;

    if icon_path.exists() {
        return Ok(icon_path.to_string_lossy().into());
    }

    if !icon_cache_dir.exists() {
        fs::create_dir_all(&icon_cache_dir).await.stringify_err()?;
    }

    let temp_name = format!("{icon_name}.downloading");
    let temp_path = ensure_icon_cache_target(&icon_cache_dir, temp_name.as_str())?;

    let response = reqwest::get(url.as_str()).await.stringify_err()?;
    let response = response.error_for_status().stringify_err()?;
    let content = response.bytes().await.stringify_err()?;

    if !is_supported_icon_content(&content) {
        let _ = temp_path.remove_if_exists().await;
        return Err(format!("Downloaded content is not a valid image: {}", url.as_str()).into());
    }

    {
        let mut file = match fs::File::create(&temp_path).await {
            Ok(file) => file,
            Err(_) => {
                if icon_path.exists() {
                    return Ok(icon_path.to_string_lossy().into());
                }
                return Err("Failed to create temporary file".into());
            }
        };
        file.write_all(content.as_ref()).await.stringify_err()?;
        file.flush().await.stringify_err()?;
    }

    if !icon_path.exists() {
        match fs::rename(&temp_path, &icon_path).await {
            Ok(_) => {}
            Err(_) => {
                let _ = temp_path.remove_if_exists().await;
                if icon_path.exists() {
                    return Ok(icon_path.to_string_lossy().into());
                }
            }
        }
    } else {
        let _ = temp_path.remove_if_exists().await;
    }

    Ok(icon_path.to_string_lossy().into())
}

pub async fn copy_icon_file(path: String, icon_info: IconInfo) -> CmdResult<String> {
    let file_path = Path::new(path.as_str());
    let icon_name = normalize_icon_segment(icon_info.name.as_str())?;
    let current_t = normalize_icon_segment(icon_info.current_t.as_str())?;
    let previous_t = if icon_info.previous_t.trim().is_empty() {
        None
    } else {
        Some(normalize_icon_segment(icon_info.previous_t.as_str())?)
    };

    let icon_dir = dirs::app_home_dir().stringify_err()?.join("icons");
    if !icon_dir.exists() {
        fs::create_dir_all(&icon_dir).await.stringify_err()?;
    }

    let ext: String = match file_path.extension() {
        Some(e) => e.to_string_lossy().into(),
        None => "ico".into(),
    };

    let dest_file_name = format!("{icon_name}-{current_t}.{ext}");
    let dest_path = ensure_icon_cache_target(&icon_dir, dest_file_name.as_str())?;

    if file_path.exists() {
        if let Some(previous_t) = previous_t {
            let previous_png = ensure_icon_cache_target(&icon_dir, format!("{icon_name}-{previous_t}.png").as_str())?;
            previous_png.remove_if_exists().await.unwrap_or_default();
            let previous_ico = ensure_icon_cache_target(&icon_dir, format!("{icon_name}-{previous_t}.ico").as_str())?;
            previous_ico.remove_if_exists().await.unwrap_or_default();
        }

        logging!(
            info,
            Type::Cmd,
            "Copying icon file path: {:?} -> file dist: {:?}",
            path,
            dest_path
        );

        match fs::copy(file_path, &dest_path).await {
            Ok(_) => Ok(dest_path.to_string_lossy().into()),
            Err(err) => Err(err.to_string().into()),
        }
    } else {
        Err("file not found".into())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn normalize_icon_segment_accepts_single_name() {
        assert!(normalize_icon_segment("group-icon.png").is_ok());
        assert!(normalize_icon_segment("alpha_1.webp").is_ok());
    }

    #[test]
    fn normalize_icon_segment_rejects_traversal_and_separators() {
        for name in ["../x", "..\\x", "a/b", "a\\b", "..", "a..b"] {
            assert!(normalize_icon_segment(name).is_err(), "name should be rejected: {name}");
        }
    }

    #[test]
    fn normalize_icon_segment_rejects_empty() {
        assert!(normalize_icon_segment("").is_err());
        assert!(normalize_icon_segment("   ").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalize_icon_segment_rejects_windows_absolute_names() {
        for name in [r"C:\temp\icon.png", r"\\server\share\icon.png"] {
            assert!(normalize_icon_segment(name).is_err(), "name should be rejected: {name}");
        }
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn normalize_icon_segment_rejects_unix_absolute_names() {
        assert!(normalize_icon_segment("/tmp/icon.png").is_err());
    }

    #[test]
    fn ensure_icon_cache_target_accepts_direct_child_only() {
        let base = PathBuf::from("icons").join("cache");
        let valid = ensure_icon_cache_target(&base, "ok.png");
        assert_eq!(valid.unwrap(), base.join("ok.png"));

        let nested = base.join("nested").join("ok.png");
        assert!(ensure_icon_cache_target(&base, nested.to_string_lossy().as_ref()).is_err());
        assert!(ensure_icon_cache_target(&base, "../ok.png").is_err());
    }

    #[test]
    fn looks_like_svg_accepts_plain_svg() {
        assert!(looks_like_svg(br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#));
    }

    #[test]
    fn looks_like_svg_accepts_xml_prefixed_svg() {
        assert!(looks_like_svg(
            br#"<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg"></svg>"#
        ));
    }

    #[test]
    fn looks_like_svg_accepts_doctype_svg() {
        assert!(looks_like_svg(
            br#"<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg xmlns="http://www.w3.org/2000/svg"></svg>"#
        ));
    }

    #[test]
    fn looks_like_svg_accepts_bom_and_leading_whitespace() {
        assert!(looks_like_svg(
            b"\xEF\xBB\xBF \n\t<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
        ));
    }

    #[test]
    fn looks_like_svg_rejects_non_svg_payloads() {
        assert!(!looks_like_svg(br#"{"status":"ok"}"#));
        assert!(!looks_like_svg(br"text/plain"));
    }

    #[test]
    fn looks_like_html_detects_common_html_prefixes() {
        assert!(looks_like_html(br"<!DOCTYPE html><html></html>"));
        assert!(looks_like_html(br"<html><body>oops</body></html>"));
        assert!(looks_like_html(br"<head><title>oops</title></head>"));
        assert!(looks_like_html(
            b"\xEF\xBB\xBF \n\t<!DOCTYPE HTML><html><body>oops</body></html>"
        ));
    }

    #[test]
    fn is_supported_icon_content_rejects_html_and_accepts_svg() {
        assert!(!is_supported_icon_content(br"<!DOCTYPE html><html></html>"));
        assert!(is_supported_icon_content(
            br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#
        ));
    }
}
