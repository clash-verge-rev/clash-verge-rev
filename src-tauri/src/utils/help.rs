use anyhow::{bail, Result};
use nanoid::nanoid;
use std::path::PathBuf;
use std::process::Command;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn get_now() -> usize {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap()
    .as_secs() as _
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
  match target.find(key) {
    Some(idx) => {
      let idx = idx + key.len();
      let value = &target[idx..];
      match match value.split(';').nth(0) {
        Some(value) => value.trim().parse(),
        None => value.trim().parse(),
      } {
        Ok(r) => Some(r),
        Err(_) => None,
      }
    }
    None => None,
  }
}

/// open file
/// use vscode by default
pub fn open_file(path: PathBuf) -> Result<()> {
  // use vscode first
  if let Ok(code) = which::which("code") {
    #[cfg(target_os = "windows")]
    {
      use std::os::windows::process::CommandExt;

      if let Err(err) = Command::new(code)
        .creation_flags(0x08000000)
        .arg(path)
        .spawn()
      {
        bail!(format!("failed to open file by VScode for `{err}`"));
      }
    }

    #[cfg(not(target_os = "windows"))]
    if let Err(err) = Command::new(code).arg(path).spawn() {
      bail!(format!("failed to open file by VScode for `{err}`"));
    }

    return Ok(());
  }

  match open::that(path) {
    Ok(_) => Ok(()),
    Err(err) => bail!(format!("failed to open file for `{err}`")),
  }
}

#[macro_export]
macro_rules! log_if_err {
  ($result: expr) => {
    if let Err(err) = $result {
      log::error!(target: "app", "{err}");
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
