//! Linux Wi-Fi SSID / BSSID 采集：通过 Wireless Extensions (WEXT) ioctl。
//!
//! 用 `SIOCGIWESSID` 读当前关联 AP 的 SSID，`SIOCGIWAP` 读 BSSID。这两个 ioctl
//! 是 Linux 无线子系统的兼容层：虽然 WEXT 被 nl80211 取代，但 cfg80211 至今保留
//! WEXT 兼容垫片，所有主流 distro（Ubuntu / Fedora / Arch / Debian 等）kernel 默
//! 认启用 `CONFIG_WIRELESS_EXT=y`，驱动会把 WEXT ioctl 翻译成 nl80211 调用。
//!
//! 选 WEXT 而非 nl80211 的理由：代码量 ~80 行 vs nl80211 genetlink 的 ~200 行
//! 且需要新引入 `netlink-packet-generic`；CVR 桌面 Linux 场景下 WEXT 兼容层
//! 覆盖足够。如果将来遇到 5GHz / VHT 专有属性需求再升级到 nl80211。
//!
//! 失败场景（静默返回 None）：
//! - iface 非无线接口（`SIOCGIWESSID` 返回 `ENODEV` / `EOPNOTSUPP`）
//! - kernel 未启用 `CONFIG_WIRELESS_EXT`（极罕见）
//! - 接口未关联 AP（ioctl 成功但 BSSID 全零 / SSID 长度为 0）
//! - socket / ioctl 失败（权限 / 文件描述符耗尽等）
//!
//! 本模块仅 Linux 编译，通过 `cfg(target_os = "linux")` 在上层 gate。

use std::ffi::c_void;
use std::mem;
use std::os::fd::{AsRawFd as _, FromRawFd as _, OwnedFd};

// Wireless Extensions ioctl 号（Linux kernel `include/uapi/linux/wireless.h`）。
// `libc` crate 未暴露，字面量来自 upstream kernel。
const SIOCGIWESSID: libc::c_ulong = 0x8B1B;
const SIOCGIWAP: libc::c_ulong = 0x8B15;

const IFNAMSIZ: usize = 16;
const IW_ESSID_MAX_SIZE: usize = 32;

/// `union iwreq_data` 的 `essid` 字段对应的 C 结构 `iw_point`，见 `linux/wireless.h`。
#[repr(C)]
struct IwPoint {
    pointer: *mut c_void,
    length: u16,
    flags: u16,
}

/// `struct iwreq` 的简化表达：`ifr_name` + 与 kernel `union iwreq_data` 同大小的
/// 16 字节负载。16 字节来自 kernel `union iwreq_data` 中最大成员（`iw_point` /
/// `sockaddr` / `iw_param`）在 64-bit 下的大小；32-bit 下 union 更小，16 字节仍
/// 足以覆盖。按需把负载前 N 字节 cast 成具体 variant（`IwPoint` 或 `libc::sockaddr`）。
///
/// `align(8)`：`IwPoint::pointer` / `libc::sockaddr` 都要求 8 字节对齐；`ifr_name`
/// 占 16 字节（IFNAMSIZ 的倍数），`data` 起始偏移是 16，对齐 8 成立。加 `align(8)`
/// 保证整个 struct 地址对齐，避免通过 `*mut u8 -> *mut IwPoint` cast 后 read/write
/// 时触发 misaligned access UB。
#[repr(C, align(8))]
struct IwReq {
    ifr_name: [u8; IFNAMSIZ],
    data: [u8; 16],
}

pub fn read_wifi_info(iface: &str) -> (Option<String>, Option<String>) {
    // 打开临时 datagram socket 发 ioctl。AF_INET / SOCK_DGRAM / 协议 0 是约定俗成
    // 的 WEXT ioctl 载体，不需要真正收发包。
    // SAFETY: libc::socket 失败返回 -1；成功返回的 fd 用 OwnedFd 管理 close。
    let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM, 0) };
    if fd < 0 {
        return (None, None);
    }
    // SAFETY: fd >= 0 由上方 check 保证；OwnedFd 获得所有权，Drop 时 close
    let sock = unsafe { OwnedFd::from_raw_fd(fd) };

    let ssid = read_ssid(sock.as_raw_fd(), iface);
    let bssid = read_bssid(sock.as_raw_fd(), iface);
    (ssid, bssid)
}

fn read_ssid(fd: libc::c_int, iface: &str) -> Option<String> {
    let mut ssid_buf = [0u8; IW_ESSID_MAX_SIZE];
    let mut req = new_iwreq(iface)?;

    // 填充 essid 字段：pointer 指向 buffer，length 是 buffer 大小。kernel 会写入
    // 实际 SSID 字节并改写 length 为实际长度。
    let iw_point = IwPoint {
        pointer: ssid_buf.as_mut_ptr().cast::<c_void>(),
        length: IW_ESSID_MAX_SIZE as u16,
        flags: 0,
    };
    // SAFETY: IwPoint 的 size(16 on 64-bit / 8 on 32-bit) <= req.data.len()(16)，
    // 64-bit 下正好占满；`#[repr(C)]` 布局与 kernel uapi 对齐；IwReq 已 align(8)
    // 满足 IwPoint 对齐需求
    unsafe {
        std::ptr::write(req.data.as_mut_ptr().cast::<IwPoint>(), iw_point);
    }

    // SAFETY: req 就地写入 kernel；req.ifr_name 已填充
    let err = unsafe { libc::ioctl(fd, SIOCGIWESSID, &mut req as *mut IwReq) };
    if err < 0 {
        return None;
    }
    // 读回 kernel 写的长度
    // SAFETY: req.data 刚由 ioctl 写入；读回 IwPoint 与 union 约定一致
    let actual = unsafe { std::ptr::read(req.data.as_ptr().cast::<IwPoint>()) };
    let len = (actual.length as usize).min(ssid_buf.len());
    if len == 0 {
        return None;
    }
    Some(String::from_utf8_lossy(&ssid_buf[..len]).into_owned())
}

fn read_bssid(fd: libc::c_int, iface: &str) -> Option<String> {
    let mut req = new_iwreq(iface)?;
    // SIOCGIWAP 的返回在 `sa_data[0..6]`，sa_family = ARPHRD_ETHER (1)。
    // SAFETY: req 就地写入；req.ifr_name 已填充
    let err = unsafe { libc::ioctl(fd, SIOCGIWAP, &mut req as *mut IwReq) };
    if err < 0 {
        return None;
    }
    // SAFETY: req.data 刚由 ioctl 写入；sockaddr 首 16 字节与 union 约定一致；
    // IwReq 已 align(8)，libc::sockaddr 的对齐需求满足
    let sa = unsafe { std::ptr::read(req.data.as_ptr().cast::<libc::sockaddr>()) };
    // `sa_data[0..6]` 是 MAC。`c_char` 在不同架构上可能是 i8（x86_64 / s390x）
    // 或 u8（aarch64 / arm / riscv64 / loongarch64 / powerpc / mips 等），`as u8`
    // 做按位 cast，两种符号性下都保留低 8 位。
    let mac = [
        sa.sa_data[0] as u8,
        sa.sa_data[1] as u8,
        sa.sa_data[2] as u8,
        sa.sa_data[3] as u8,
        sa.sa_data[4] as u8,
        sa.sa_data[5] as u8,
    ];
    if mac == [0u8; 6] {
        return None;
    }
    Some(format!(
        "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
    ))
}

fn new_iwreq(iface: &str) -> Option<IwReq> {
    let bytes = iface.as_bytes();
    if bytes.len() >= IFNAMSIZ {
        // iface 名超长（理论 IFNAMSIZ-1=15 字节上限），无法塞进 ifr_name
        return None;
    }
    let mut req: IwReq = unsafe { mem::zeroed() };
    req.ifr_name[..bytes.len()].copy_from_slice(bytes);
    Some(req)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iface_name_too_long_rejected() {
        assert!(new_iwreq("a".repeat(IFNAMSIZ).as_str()).is_none());
        assert!(new_iwreq("a".repeat(IFNAMSIZ - 1).as_str()).is_some());
    }
}
