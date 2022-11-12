#![cfg(target_os = "windows")]
#![allow(non_snake_case)]
#![allow(non_camel_case_types)]

//!
//! From https://github.com/tauri-apps/window-vibrancy/blob/dev/src/windows.rs
//!

use windows_sys::Win32::{
    Foundation::*,
    System::{LibraryLoader::*, SystemInformation::*},
};

fn get_function_impl(library: &str, function: &str) -> Option<FARPROC> {
    assert_eq!(library.chars().last(), Some('\0'));
    assert_eq!(function.chars().last(), Some('\0'));

    let module = unsafe { LoadLibraryA(library.as_ptr()) };
    if module == 0 {
        return None;
    }
    Some(unsafe { GetProcAddress(module, function.as_ptr()) })
}

macro_rules! get_function {
    ($lib:expr, $func:ident) => {
        get_function_impl(concat!($lib, '\0'), concat!(stringify!($func), '\0')).map(|f| unsafe {
            std::mem::transmute::<::windows_sys::Win32::Foundation::FARPROC, $func>(f)
        })
    };
}

/// Returns a tuple of (major, minor, buildnumber)
fn get_windows_ver() -> Option<(u32, u32, u32)> {
    type RtlGetVersion = unsafe extern "system" fn(*mut OSVERSIONINFOW) -> i32;
    let handle = get_function!("ntdll.dll", RtlGetVersion);
    if let Some(rtl_get_version) = handle {
        unsafe {
            let mut vi = OSVERSIONINFOW {
                dwOSVersionInfoSize: 0,
                dwMajorVersion: 0,
                dwMinorVersion: 0,
                dwBuildNumber: 0,
                dwPlatformId: 0,
                szCSDVersion: [0; 128],
            };

            let status = (rtl_get_version)(&mut vi as _);

            if status >= 0 {
                Some((vi.dwMajorVersion, vi.dwMinorVersion, vi.dwBuildNumber))
            } else {
                None
            }
        }
    } else {
        None
    }
}

pub fn is_win11() -> bool {
    let v = get_windows_ver().unwrap_or_default();
    v.2 >= 22000
}

#[test]
fn test_version() {
    dbg!(get_windows_ver().unwrap_or_default());
}
