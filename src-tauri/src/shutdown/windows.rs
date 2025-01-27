use tauri::Manager;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, CW_USEDEFAULT,
        WM_ENDSESSION, WM_QUERYENDSESSION, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_OVERLAPPED,
    },
};

use crate::{core::handle, utils::resolve};

// code refer to:
//      global-hotkey (https://github.com/tauri-apps/global-hotkey)
//      Global Shortcut (https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/global-shortcut)

struct ShutdownState {
    hwnd: HWND,
}

unsafe impl Send for ShutdownState {}
unsafe impl Sync for ShutdownState {}

impl Drop for ShutdownState {
    fn drop(&mut self) {
        // this log not be printed, I don't know why.
        log::info!("Dropping ShutdownState, destroying window");
        unsafe {
            DestroyWindow(self.hwnd);
        }
    }
}

unsafe extern "system" fn shutdown_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // refer: https://learn.microsoft.com/zh-cn/windows/win32/shutdown/shutting-down#shutdown-notifications
    // only perform reset operations in `WM_ENDSESSION`
    match msg {
        WM_QUERYENDSESSION => {
            log::info!("System is shutting down or user is logging off.");
        }
        WM_ENDSESSION => {
            log::info!("Session ended, system shutting down.");
            resolve::resolve_reset();
            log::info!("resolved reset finished");
        }
        _ => {}
    };
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn encode_wide<S: AsRef<std::ffi::OsStr>>(string: S) -> Vec<u16> {
    std::os::windows::prelude::OsStrExt::encode_wide(string.as_ref())
        .chain(std::iter::once(0))
        .collect()
}

fn get_instance_handle() -> windows_sys::Win32::Foundation::HMODULE {
    // Gets the instance handle by taking the address of the
    // pseudo-variable created by the microsoft linker:
    // https://devblogs.microsoft.com/oldnewthing/20041025-00/?p=37483

    // This is preferred over GetModuleHandle(NULL) because it also works in DLLs:
    // https://stackoverflow.com/questions/21718027/getmodulehandlenull-vs-hinstance

    extern "C" {
        static __ImageBase: windows_sys::Win32::System::SystemServices::IMAGE_DOS_HEADER;
    }

    unsafe { &__ImageBase as *const _ as _ }
}

pub fn register() {
    let app_hanlde = handle::Handle::global()
        .get_app_handle()
        .expect("faild to get app handle");
    let class_name = encode_wide("global_shutdown_app");
    unsafe {
        let hinstance = get_instance_handle();

        let wnd_class = WNDCLASSW {
            lpfnWndProc: Some(shutdown_proc),
            lpszClassName: class_name.as_ptr(),
            hInstance: hinstance,
            ..std::mem::zeroed()
        };

        RegisterClassW(&wnd_class);

        let hwnd = CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED |
            // WS_EX_TOOLWINDOW prevents this window from ever showing up in the taskbar, which
            // we want to avoid. If you remove this style, this window won't show up in the
            // taskbar *initially*, but it can show up at some later point. This can sometimes
            // happen on its own after several hours have passed, although this has proven
            // difficult to reproduce. Alternatively, it can be manually triggered by killing
            // `explorer.exe` and then starting the process back up.
            // It is unclear why the bug is triggered by waiting for several hours.
            WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            std::ptr::null(),
            WS_OVERLAPPED,
            CW_USEDEFAULT,
            0,
            CW_USEDEFAULT,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null_mut(),
        );
        if hwnd.is_null() {
            log::error!("failed to create shutdown window");
        } else {
            app_hanlde.manage(ShutdownState { hwnd });
        }
    }
}
