use anyhow::{anyhow, bail, Context, Result};
use nanoid::nanoid;
use serde::{de::DeserializeOwned, Serialize};
use serde_yaml::{Mapping, Value};
use std::{fs, path::PathBuf, process::Command, str::FromStr};

/// read data from yaml as struct T
pub fn read_yaml<T: DeserializeOwned>(path: &PathBuf) -> Result<T> {
    if !path.exists() {
        bail!("file not found \"{}\"", path.display());
    }

    let yaml_str = fs::read_to_string(&path)
        .with_context(|| format!("failed to read the file \"{}\"", path.display()))?;

    serde_yaml::from_str::<T>(&yaml_str).with_context(|| {
        format!(
            "failed to read the file with yaml format \"{}\"",
            path.display()
        )
    })
}

/// read mapping from yaml fix #165
pub fn read_merge_mapping(path: &PathBuf) -> Result<Mapping> {
    let mut val: Value = read_yaml(path)?;
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
    target.find(key).and_then(|idx| {
        let idx = idx + key.len();
        let value = &target[idx..];

        match value.split(';').nth(0) {
            Some(value) => value.trim().parse(),
            None => value.trim().parse(),
        }
        .ok()
    })
}

/// open file
/// use vscode by default
pub fn open_file(path: PathBuf) -> Result<()> {
    // use vscode first
    if let Ok(code) = which::which("code") {
        let mut command = Command::new(&code);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            if let Err(err) = command.creation_flags(0x08000000).arg(&path).spawn() {
                log::error!(target: "app", "failed to open with VScode `{err}`");
                open::that(path)?;
            }
        }

        #[cfg(not(target_os = "windows"))]
        if let Err(err) = command.arg(&path).spawn() {
            log::error!(target: "app", "failed to open with VScode `{err}`");
            open::that(path)?;
        }

        return Ok(());
    }

    open::that(path)?;
    Ok(())
}

#[macro_export]
macro_rules! error {
    ($result: expr) => {
        log::error!(target: "app", "{}", $result);
    };
}

#[macro_export]
macro_rules! log_err {
    ($result: expr) => {
        if let Err(err) = $result {
            log::error!(target: "app", "{err}");
        }
    };

    ($result: expr, $err_str: expr) => {
        if let Err(_) = $result {
            log::error!(target: "app", "{}", $err_str);
        }
    };
}

/// wrap the anyhow error
/// transform the error to String
#[macro_export]
macro_rules! wrap_err {
    ($stat: expr) => {
        match $stat {
            Ok(a) => Ok(a),
            Err(err) => {
                log::error!(target: "app", "{}", err.to_string());
                Err(format!("{}", err.to_string()))
            }
        }
    };
}

/// return the string literal error
#[macro_export]
macro_rules! ret_err {
    ($str: expr) => {
        return Err($str.into())
    };
}

#[test]
fn test_parse_value() {
    let test_1 = "upload=111; download=2222; total=3333; expire=444";
    let test_2 = "attachment; filename=Clash.yaml";

    assert_eq!(parse_str::<usize>(test_1, "upload=").unwrap(), 111);
    assert_eq!(parse_str::<usize>(test_1, "download=").unwrap(), 2222);
    assert_eq!(parse_str::<usize>(test_1, "total=").unwrap(), 3333);
    assert_eq!(parse_str::<usize>(test_1, "expire=").unwrap(), 444);
    assert_eq!(
        parse_str::<String>(test_2, "filename=").unwrap(),
        format!("Clash.yaml")
    );

    assert_eq!(parse_str::<usize>(test_1, "aaa="), None);
    assert_eq!(parse_str::<usize>(test_1, "upload1="), None);
    assert_eq!(parse_str::<usize>(test_1, "expire1="), None);
    assert_eq!(parse_str::<usize>(test_2, "attachment="), None);
}
