//! Windows Wi-Fi SSID / BSSID 采集（WlanAPI）。
//!
//! 被 [`super::sampler`] 在 `iface_type == Wifi` 且 `wifi_detection_enabled()`
//! 时按 per-iface LUID 调用；其它场景（以太 / wwan / vpn，或用户关闭 Wi-Fi 识别）
//! 全部跳过。
//!
//! **失败语义**：任一步失败（WlanSvc 不可用 / 该 LUID 不对应任何 WLAN
//! interface / 接口未连接）都静默返回 `(None, None)`——此时 sampler 仍会上报
//! 该 iface 的 `iface_type=Wifi`，matcher 只是认为 SSID / BSSID 未知不命中。

use std::ffi::c_void;
use std::ptr;

use windows::Win32::Foundation::{HANDLE, NO_ERROR};
use windows::Win32::NetworkManagement::IpHelper::ConvertInterfaceGuidToLuid;
use windows::Win32::NetworkManagement::Ndis::NET_LUID_LH;
use windows::Win32::NetworkManagement::WiFi::{
    WLAN_API_VERSION_2_0, WLAN_CONNECTION_ATTRIBUTES, WLAN_INTERFACE_INFO_LIST, WlanCloseHandle,
    WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle, WlanQueryInterface,
    wlan_intf_opcode_current_connection,
};

use super::probe;

/// 通过 WlanAPI 读取指定 LUID 对应 Wi-Fi 接口的 SSID / BSSID。
///
/// **性能**：每次 collect 都开 / 关一个 WlanSvc client handle。去抖后采集频率
/// ≤ 1 次 / 几秒，开销可忽略；不做 handle 缓存以避免跨调用的 Send/Sync 复杂度。
pub fn read_wifi_info(primary_luid: u64) -> (Option<String>, Option<String>) {
    let mut client_handle = HANDLE::default();
    let mut negotiated_version = 0u32;
    // SAFETY: WlanOpenHandle 按文档接受 v2 版本号；client_handle 由下方 RAII guard 管理
    let err =
        unsafe { WlanOpenHandle(WLAN_API_VERSION_2_0, None, &mut negotiated_version, &mut client_handle) };
    if err != NO_ERROR.0 {
        return (None, None);
    }

    struct WlanClientGuard(HANDLE);
    impl Drop for WlanClientGuard {
        fn drop(&mut self) {
            // SAFETY: handle 来自刚成功返回的 WlanOpenHandle，未被释放
            let _ = unsafe { WlanCloseHandle(self.0, None) };
        }
    }
    let _client = WlanClientGuard(client_handle);

    let mut iface_list: *mut WLAN_INTERFACE_INFO_LIST = ptr::null_mut();
    // SAFETY: iface_list 由 WlanFreeMemory 释放，RAII guard 管理
    let err = unsafe { WlanEnumInterfaces(client_handle, None, &mut iface_list) };
    if err != NO_ERROR.0 || iface_list.is_null() {
        return (None, None);
    }

    struct WlanMemGuard(*mut c_void);
    impl Drop for WlanMemGuard {
        fn drop(&mut self) {
            // SAFETY: 指针由 WlanEnumInterfaces / WlanQueryInterface 分配，未释放
            unsafe { WlanFreeMemory(self.0) };
        }
    }
    let _list_mem = WlanMemGuard(iface_list.cast());

    // SAFETY: iface_list != null 由上方 check 保证；struct 布局由 WlanAPI 稳定
    let (count, infos_ptr) = unsafe {
        let list = &*iface_list;
        (list.dwNumberOfItems as usize, list.InterfaceInfo.as_ptr())
    };
    // SAFETY: InterfaceInfo 是 ANYSIZE_ARRAY，长度由 dwNumberOfItems 决定
    let infos = unsafe { std::slice::from_raw_parts(infos_ptr, count) };

    for info in infos {
        let mut luid = NET_LUID_LH::default();
        // SAFETY: ConvertInterfaceGuidToLuid 仅读 guid 字段、写 luid
        let r = unsafe { ConvertInterfaceGuidToLuid(&info.InterfaceGuid, &mut luid) };
        if r != NO_ERROR {
            continue;
        }
        // SAFETY: NET_LUID_LH.Value 是 union 字段
        if unsafe { luid.Value } != primary_luid {
            continue;
        }

        // 匹配到 wifi interface，查当前连接
        let mut data_ptr: *mut c_void = ptr::null_mut();
        let mut data_size = 0u32;
        // SAFETY: WlanQueryInterface 写 data_ptr + data_size；返回 buffer 由 WlanFreeMemory 释放
        let err = unsafe {
            WlanQueryInterface(
                client_handle,
                &info.InterfaceGuid,
                wlan_intf_opcode_current_connection,
                None,
                &mut data_size,
                &mut data_ptr,
                None,
            )
        };
        if err != NO_ERROR.0 || data_ptr.is_null() {
            // 接口存在但未关联任何 AP（ERROR_INVALID_STATE 等）
            return (None, None);
        }
        let _data_mem = WlanMemGuard(data_ptr);

        // 防御性：WlanAPI 文档保证 current_connection 成功时返回完整的
        // `WLAN_CONNECTION_ATTRIBUTES`；但异常 / 兼容性路径若 data_size 短于该
        // 结构，cast 后读字段就越界。正常系统路径该分支不会命中。
        if (data_size as usize) < std::mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>() {
            return (None, None);
        }

        // SAFETY: data_size 已校验 >= sizeof(WLAN_CONNECTION_ATTRIBUTES)；
        // 布局由 WlanAPI 稳定，ABI 与 windows crate binding 对齐
        let attrs = unsafe { &*data_ptr.cast::<WLAN_CONNECTION_ATTRIBUTES>() };
        let assoc = &attrs.wlanAssociationAttributes;

        let ssid_len = (assoc.dot11Ssid.uSSIDLength as usize).min(assoc.dot11Ssid.ucSSID.len());
        let ssid_bytes = &assoc.dot11Ssid.ucSSID[..ssid_len];
        let ssid = if ssid_bytes.is_empty() {
            None
        } else {
            // SSID 规范层面是任意 octet 序列，实际几乎都是 UTF-8 / ASCII；
            // from_utf8_lossy 对非法字节用 U+FFFD 替换（优于 panic 或 drop 非法帧）
            Some(String::from_utf8_lossy(ssid_bytes).into_owned())
        };

        let bssid_bytes = assoc.dot11Bssid;
        let bssid = if bssid_bytes == [0u8; 6] {
            None
        } else {
            Some(probe::format_mac(&bssid_bytes))
        };

        return (ssid, bssid);
    }

    (None, None)
}
