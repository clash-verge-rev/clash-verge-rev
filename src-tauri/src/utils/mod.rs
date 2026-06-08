#[cfg(target_os = "macos")]
pub mod connections_stream;
pub mod dirs;
pub mod help;
pub mod init;
// Linux and FreeBSD share this module: mime (freedesktop xdg-mime integration) is common to both platforms;
// workarounds (Nvidia DMABUF / Wayland fixes) only called on Linux, but only depend on std, can compile
// together on FreeBSD (just not called).
#[cfg(any(target_os = "linux", target_os = "freebsd"))]
pub mod linux;
pub mod network;
pub mod notification;
pub mod resolve;
#[cfg(target_os = "windows")]
pub mod schtasks;
pub mod server;
pub mod singleton;
pub mod speed;
pub mod tmpl;
#[cfg(target_os = "macos")]
pub mod tray_speed;
pub mod window_manager;
