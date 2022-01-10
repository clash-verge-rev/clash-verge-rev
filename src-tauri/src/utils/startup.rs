use std::io;
use std::path::PathBuf;

static APP_KEY: &str = "ClashVerge";

#[cfg(target_os = "windows")]
/// get the startup value
/// whether as same as the exe_path
pub fn get_startup(exe_path: &PathBuf) -> io::Result<bool> {
  use winreg::enums::*;
  use winreg::RegKey;

  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let cur_var = hkcu.open_subkey_with_flags(
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    KEY_READ,
  )?;

  match cur_var.get_value::<String, _>(APP_KEY) {
    Ok(path) => {
      let exe_path = exe_path.clone();
      let exe_path = exe_path.as_os_str().to_str().unwrap();
      Ok(path == exe_path)
    }
    Err(_) => Ok(false),
  }
}

#[cfg(target_os = "windows")]
/// set the startup on windows
/// delete the reg key if disabled
pub fn set_startup(enable: bool, exe_path: &PathBuf) -> io::Result<()> {
  use winreg::enums::*;
  use winreg::RegKey;

  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let cur_var = hkcu.open_subkey_with_flags(
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
    KEY_SET_VALUE,
  )?;

  match enable {
    true => {
      let exe_path = exe_path.clone();
      let exe_path = exe_path.as_os_str().to_str().unwrap();
      cur_var.set_value::<&str, _>(APP_KEY, &exe_path)
    }
    false => cur_var.delete_value(APP_KEY),
  }
}

#[cfg(target_os = "windows")]
#[test]
fn test() {
  let path = PathBuf::from(r"D:\Software\Clash Verge\clash-verge.exe");

  assert!(set_startup(true, &path).is_ok());
  assert_eq!(get_startup(&path).unwrap(), true);

  assert!(set_startup(false, &path).is_ok());
  assert_eq!(get_startup(&path).unwrap(), false);
}
