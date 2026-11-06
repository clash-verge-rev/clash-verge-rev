use crate::core::notify::NoticeStatus;
use crate::{config::with_encryption, process::AsyncHandler};
use anyhow::{Context as _, Result, anyhow, bail};
use clash_verge_logging::{Type, logging};
use nanoid::nanoid;
use scopeguard::{ScopeGuard, guard};
use serde::{Serialize, de::DeserializeOwned};
use serde_yaml_ng::{Mapping, Value};
use std::{
    borrow::Cow,
    ops::Range,
    path::{Path, PathBuf},
    str::FromStr,
};
use tokio::io::AsyncWriteExt as _;

pub async fn read_yaml<T: DeserializeOwned>(path: &Path) -> Result<T> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        bail!("file not found \"{}\"", path.display());
    }

    let yaml_str = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("failed to read YAML file {}", path.display()))?;

    with_encryption(|| async { serde_yaml_ng::from_str::<T>(&yaml_str) })
        .await
        .with_context(|| format!("failed to parse YAML file {}", path.display()))
}

pub async fn read_mapping(path: &Path) -> Result<Mapping> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        bail!("file not found \"{}\"", path.display());
    }

    let bytes = tokio::fs::read(path)
        .await
        .with_context(|| format!("failed to read the file \"{}\"", path.display()))?;
    let yaml_str =
        String::from_utf8(bytes).with_context(|| format!("failed to read the file \"{}\"", path.display()))?;
    let label = path.to_path_buf();

    // Parsing a multi-megabyte profile is pure CPU; keep it off the async worker.
    AsyncHandler::spawn_blocking(move || parse_mapping(yaml_str, label))
        .await
        .map_err(|join| anyhow!("yaml parse task failed: {join}"))?
}

fn parse_mapping(yaml_str: String, path: PathBuf) -> Result<Mapping> {
    match short_id_tolerant(&yaml_str, &path) {
        Ok((_, mut val)) => {
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

            crate::core::handle::Handle::notice(NoticeStatus::ConfigValidateYamlSyntaxError, error_msg.as_str());

            bail!("YAML syntax error: {}", err)
        }
    }
}

const SHORT_ID_KEY: &str = "short-id:";

/// A float like `1234e123` loses its hex text, so quote short-ids before parsing and keep that only if nothing else changed.
pub(crate) fn short_id_tolerant<'a>(yaml: &'a str, path: &Path) -> serde_yaml_ng::Result<(Cow<'a, str>, Value)> {
    let original = serde_yaml_ng::from_str::<Value>(yaml)?;
    if !has_numeric_short_id(&original) {
        return Ok((Cow::Borrowed(yaml), original));
    }
    let quoted = quote_plain_short_ids(yaml);
    if matches!(quoted, Cow::Borrowed(_)) {
        return Ok((quoted, original));
    }

    match serde_yaml_ng::from_str::<Value>(&quoted) {
        Ok(tolerant) if same_except_short_id_text(&original, &tolerant) => Ok((quoted, tolerant)),
        _ => {
            logging!(
                warn,
                Type::Config,
                "kept numeric short-id in {}: quoting it would change other values",
                path.display()
            );
            Ok((Cow::Borrowed(yaml), original))
        }
    }
}

fn has_numeric_short_id(value: &Value) -> bool {
    match value {
        Value::Mapping(map) => map
            .iter()
            .any(|(key, value)| (is_short_id_key(key) && value.is_number()) || has_numeric_short_id(value)),
        Value::Sequence(seq) => seq.iter().any(has_numeric_short_id),
        Value::Tagged(tagged) => has_numeric_short_id(&tagged.value),
        _ => false,
    }
}

fn same_except_short_id_text(original: &Value, tolerant: &Value) -> bool {
    match (original, tolerant) {
        (Value::Mapping(original), Value::Mapping(tolerant)) => {
            original.len() == tolerant.len()
                && original
                    .iter()
                    .zip(tolerant.iter())
                    .all(|((key, old), (new_key, new))| {
                        key == new_key && (same_except_short_id_text(old, new) || is_short_id_text(key, old, new))
                    })
        }
        (Value::Sequence(original), Value::Sequence(tolerant)) => {
            original.len() == tolerant.len()
                && original
                    .iter()
                    .zip(tolerant.iter())
                    .all(|(old, new)| same_except_short_id_text(old, new))
        }
        (Value::Tagged(original), Value::Tagged(tolerant)) => {
            original.tag == tolerant.tag && same_except_short_id_text(&original.value, &tolerant.value)
        }
        _ => original == tolerant,
    }
}

fn is_short_id_text(key: &Value, old: &Value, new: &Value) -> bool {
    is_short_id_key(key)
        && old.is_number()
        && matches!(new, Value::String(text) if serde_yaml_ng::from_str::<Value>(text).ok().as_ref() == Some(old))
}

fn is_short_id_key(key: &Value) -> bool {
    key.as_str() == Some("short-id")
}

fn quote_plain_short_ids(yaml: &str) -> Cow<'_, str> {
    let mut quoted = String::new();
    let mut copied = 0;
    for (key, _) in yaml.match_indices(SHORT_ID_KEY) {
        let Some(value) = plain_short_id_at(yaml, key) else {
            continue;
        };
        let (Some(head), Some(id)) = (yaml.get(copied..value.start), yaml.get(value.clone())) else {
            continue;
        };
        quoted.push_str(head);
        quoted.push('"');
        quoted.push_str(id);
        quoted.push('"');
        copied = value.end;
    }

    if copied == 0 {
        return Cow::Borrowed(yaml);
    }
    quoted.push_str(yaml.get(copied..).unwrap_or_default());
    Cow::Owned(quoted)
}

fn plain_short_id_at(yaml: &str, key: usize) -> Option<Range<usize>> {
    let bytes = yaml.as_bytes();
    let before = bytes.get(..key)?;
    let flow = matches!(
        before.iter().rev().find(|byte| !byte.is_ascii_whitespace()),
        Some(b'{' | b',')
    );
    let line_start = before
        .iter()
        .rev()
        .take_while(|&&byte| byte != b'\n')
        .all(|&byte| is_blank(byte));
    if !flow && !line_start {
        return None;
    }

    let start = key + SHORT_ID_KEY.len();
    let gap = bytes.get(start..)?.iter().take_while(|&&byte| is_blank(byte)).count();
    if gap == 0 {
        return None;
    }
    let start = start + gap;
    let len = bytes
        .get(start..)?
        .iter()
        .take_while(|byte| byte.is_ascii_hexdigit())
        .count();
    if len == 0 || !ends_plain_short_id(bytes.get(start + len..)?, flow) {
        return None;
    }
    Some(start..start + len)
}

fn ends_plain_short_id(rest: &[u8], flow: bool) -> bool {
    let blanks = rest.iter().take_while(|&&byte| is_blank(byte)).count();
    match rest.get(blanks..) {
        Some([] | [b'\n', ..] | [b'\r', b'\n', ..]) => true,
        Some([b'#', ..]) => blanks > 0,
        Some([b',' | b'}', ..]) => flow,
        _ => false,
    }
}

const fn is_blank(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

pub async fn save_yaml<T: Serialize + Sync>(path: &Path, data: &T, prefix: Option<&str>) -> Result<()> {
    let data_str = with_encryption(|| async { serde_yaml_ng::to_string(data) }).await?;

    let yaml_str = match prefix {
        Some(prefix) => format!("{prefix}\n\n{data_str}"),
        None => data_str,
    };

    save_yaml_str(path, &yaml_str).await
}

/// Atomic replace with pre-serialized content; the payload must not need the encryption scope.
pub async fn save_yaml_str(path: &Path, yaml_str: &str) -> Result<()> {
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

#[cfg(test)]
#[allow(clippy::expect_used, reason = "tests assert by panicking")]
mod tests {
    use super::{has_numeric_short_id, parse_mapping, quote_plain_short_ids, short_id_tolerant};
    use serde_yaml_ng::Value;
    use std::{
        borrow::Cow,
        path::{Path, PathBuf},
    };

    #[test]
    fn quotes_plain_short_ids() {
        let cases = [
            ("short-id: 1234e123", "short-id: \"1234e123\""),
            ("short-id: 0e5", "short-id: \"0e5\""),
            ("short-id: 12345678", "short-id: \"12345678\""),
            ("short-id: 6ba85179", "short-id: \"6ba85179\""),
            ("short-id: \"1234e123\"", "short-id: \"1234e123\""),
            ("short-id: '1234e123'", "short-id: '1234e123'"),
            ("short-id: \"\"", "short-id: \"\""),
            ("short-id:\npublic-key: k", "short-id:\npublic-key: k"),
            ("short-id: null", "short-id: null"),
            ("short-id: ~", "short-id: ~"),
            ("short-id: 1234e123 # note", "short-id: \"1234e123\" # note"),
            ("# short-id: 1234e123", "# short-id: 1234e123"),
            (
                "reality-opts: {public-key: k, short-id: 1234e123}",
                "reality-opts: {public-key: k, short-id: \"1234e123\"}",
            ),
            (
                "reality-opts: {short-id: 1234e123, public-key: k}",
                "reality-opts: {short-id: \"1234e123\", public-key: k}",
            ),
            (
                "{\n  public-key: k,\n  short-id: 1234e123\n}",
                "{\n  public-key: k,\n  short-id: \"1234e123\"\n}",
            ),
            ("short-id: &sid 1234e123", "short-id: &sid 1234e123"),
            ("short-id: !!str 1234e123", "short-id: !!str 1234e123"),
            ("short-id: abc,def", "short-id: abc,def"),
            ("short-id: 1234e123\r\n", "short-id: \"1234e123\"\r\n"),
            ("my-short-id: 1234e123", "my-short-id: 1234e123"),
            ("xshort-id: 1", "xshort-id: 1"),
            ("short-id:1234e123", "short-id:1234e123"),
            ("short-id: 1.5e3", "short-id: 1.5e3"),
        ];

        for (input, expected) in cases {
            let output = quote_plain_short_ids(input);
            assert_eq!(output, expected, "input: {input:?}");
            assert_eq!(
                matches!(output, Cow::Borrowed(_)),
                input == expected,
                "input: {input:?}"
            );
            assert_eq!(quote_plain_short_ids(&output), expected, "rerun: {input:?}");
        }
    }

    #[test]
    fn plain_short_id_survives_profile_parse() {
        let profile = "\
proxies:
  - name: r
    type: vless
    reality-opts:
      public-key: SFv3pZQdZ1fpnNg9yI2RwXKqAOz4mZHRbT2Wq4kz8Ws
      short-id: 1234e123
";
        let mapping = parse_mapping(profile.into(), PathBuf::from("profile.yaml")).expect("profile should parse");
        let short_id = mapping
            .get("proxies")
            .and_then(|proxies| proxies.get(0))
            .and_then(|proxy| proxy.get("reality-opts"))
            .and_then(|opts| opts.get("short-id"));
        assert_eq!(short_id, Some(&Value::String("1234e123".into())));

        let output = serde_yaml_ng::to_string(&mapping).expect("mapping should serialize");
        assert!(output.contains("short-id: '1234e123'"), "{output}");
    }

    #[test]
    fn short_id_rewrite_falls_back_to_original_parse() {
        // (case, input, has a numeric short-id today)
        let cases = [
            ("B2", "proxies:\n  - name: \"node, short-id: 1234e123}\"\n", false),
            (
                "B3",
                "proxies:\n  - name: \"node, short-id: 1234e123}\"\n  - name: r\n    reality-opts:\n      short-id: 1234e123\n",
                true,
            ),
            (
                "B4",
                "payload: |\n  short-id: 1234e123\nreality-opts:\n  short-id: 1234e123\n",
                true,
            ),
            ("B5", "reality-opts:\n  short-id: 1234e123\n    more\n", false),
            ("B6", "reality-opts: {public-key: k, # c\n  short-id: 1234e123}\n", true),
        ];

        for (case, input, numeric) in cases {
            let today = serde_yaml_ng::from_str::<Value>(input).expect("input should parse");
            assert_eq!(has_numeric_short_id(&today), numeric, "{case}");
            let (text, value) = short_id_tolerant(input, Path::new("b.yaml")).expect("input should parse");
            assert!(matches!(text, Cow::Borrowed(_)), "{case}");
            assert_eq!(value, today, "{case}");
        }
    }

    #[test]
    fn short_id_rewrite_keeps_every_numeric_short_id() {
        let input = "\
proxies:
  - name: a
    reality-opts:
      short-id: 1234e123
  - {name: b, reality-opts: {short-id: 0e5}}
";
        let (text, value) = short_id_tolerant(input, Path::new("b7.yaml")).expect("input should parse");
        assert!(matches!(text, Cow::Owned(_)));
        let short_ids: Vec<_> = value
            .get("proxies")
            .and_then(Value::as_sequence)
            .expect("proxies should be a sequence")
            .iter()
            .map(|proxy| proxy.get("reality-opts").and_then(|opts| opts.get("short-id")).cloned())
            .collect();
        assert_eq!(
            short_ids,
            [
                Some(Value::String("1234e123".into())),
                Some(Value::String("0e5".into()))
            ]
        );
    }
}
