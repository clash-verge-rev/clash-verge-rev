#![cfg(target_os = "windows")]

//! WinRT Mobile Hotspot session driven from one dedicated thread.
//!
//! Everything that touches `NetworkOperatorTetheringManager` stays on this
//! thread so the WinRT apartment never crosses the Tauri runtime.

use super::{
    HotspotAdapter, HotspotDevice, HotspotStartConfig, HotspotState, HotspotStatus, Publisher, START_TIMEOUT,
    STATUS_POLL, STOP_TIMEOUT,
};
use anyhow::{Context as _, Result, anyhow, bail};
use std::collections::HashSet;
use std::ffi::CStr;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use windows::Devices::WiFi::WiFiAdapter;
use windows::Networking::Connectivity::{ConnectionProfile, NetworkAdapter, NetworkInformation};
use windows::Networking::NetworkOperators::{
    NetworkOperatorTetheringAccessPointConfiguration, NetworkOperatorTetheringManager, TetheringCapability,
    TetheringOperationStatus, TetheringOperationalState, TetheringWiFiBand,
};
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
use windows::core::{GUID, HSTRING};
use windows_sys::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, GetAdaptersAddresses,
    IP_ADAPTER_ADDRESSES_LH,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC, SOCKADDR_IN};

const IF_TYPE_IEEE80211: u32 = 71;
const IF_OPER_STATUS_UP: i32 = 1;
const ICS_DEFAULT_PREFIX: [u8; 3] = [192, 168, 137];

enum WorkerCommand {
    Stop(Sender<Result<()>>),
}

pub(crate) struct Worker {
    commands: Sender<WorkerCommand>,
    join: Option<JoinHandle<()>>,
}

impl Worker {
    pub(crate) fn is_finished(&self) -> bool {
        self.join.as_ref().is_none_or(std::thread::JoinHandle::is_finished)
    }

    pub(crate) fn join(mut self) {
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }

    pub(crate) fn stop(mut self) -> Result<()> {
        let (reply, answer) = mpsc::channel();
        let delivered = self.commands.send(WorkerCommand::Stop(reply)).is_ok();
        let result = if delivered {
            match answer.recv_timeout(STOP_TIMEOUT) {
                Ok(result) => result,
                Err(RecvTimeoutError::Timeout) => Err(anyhow!("hotspot cleanup timed out")),
                Err(RecvTimeoutError::Disconnected) => Err(anyhow!("hotspot worker stopped before cleanup completed")),
            }
        } else {
            Ok(())
        };

        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
        result
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        // The app may drop the manager during exit; ask for cleanup without blocking.
        let (reply, _) = mpsc::channel();
        let _ = self.commands.send(WorkerCommand::Stop(reply));
    }
}

pub(crate) fn start_worker(
    config: HotspotStartConfig,
    tun_device: std::string::String,
    publisher: Publisher,
) -> Result<(Worker, HotspotStatus)> {
    let (commands, command_rx) = mpsc::channel();
    let (started_tx, started_rx) = mpsc::channel();
    let thread_publisher = Arc::clone(&publisher);

    let join = std::thread::Builder::new()
        .name("clash-verge-hotspot".into())
        .spawn(move || {
            // Every WinRT call below runs on this thread, in its own MTA.
            let apartment = unsafe { RoInitialize(RO_INIT_MULTITHREADED).is_ok() };
            match Session::start(&config, &tun_device) {
                Ok(mut session) => {
                    if started_tx.send(Ok(session.status())).is_err() {
                        let _ = session.cleanup();
                    } else {
                        session.run(&command_rx, &thread_publisher);
                    }
                }
                Err(error) => {
                    thread_publisher(HotspotStatus {
                        state: HotspotState::Failed,
                        ssid: config.ssid.clone(),
                        band: config.band.clone(),
                        message: Some(format!("{error:#}")),
                        ..HotspotStatus::default()
                    });
                    let _ = started_tx.send(Err(error));
                }
            }
            if apartment {
                unsafe { RoUninitialize() };
            }
        })
        .context("failed to spawn the hotspot worker")?;

    match started_rx.recv_timeout(START_TIMEOUT) {
        Ok(Ok(status)) => Ok((
            Worker {
                commands,
                join: Some(join),
            },
            status,
        )),
        Ok(Err(error)) => {
            let _ = join.join();
            Err(error)
        }
        Err(_) => Err(anyhow!(
            "starting the hotspot timed out; check Windows Mobile Hotspot state"
        )),
    }
}

struct Session {
    manager: NetworkOperatorTetheringManager,
    original: NetworkOperatorTetheringAccessPointConfiguration,
    restore_no_connections_timeout: bool,
    config: HotspotStartConfig,
    tun_device: std::string::String,
    configured_band: std::string::String,
    ap_baseline: HashSet<GUID>,
    ap_adapter: Option<std::string::String>,
    gateway: Option<std::string::String>,
    clients: u32,
    devices: Vec<HotspotDevice>,
    force_auto_band: bool,
    cleanup_done: bool,
}

impl Session {
    fn start(config: &HotspotStartConfig, tun_device: &str) -> Result<Self> {
        let tun = find_tun_adapter(tun_device)?;
        let profile = find_profile(tun.guid)?;

        let capability = NetworkOperatorTetheringManager::GetTetheringCapabilityFromConnectionProfile(&profile)
            .context("failed to query Windows tethering capability")?;
        if capability != TetheringCapability::Enabled {
            bail!("Windows tethering capability is {capability:?}");
        }

        let adapter = match config.adapter_id.as_deref() {
            Some(id) if !id.is_empty() => Some(resolve_network_adapter(parse_guid(id)?)?),
            _ => None,
        };
        let manager = match adapter {
            Some(adapter) => {
                NetworkOperatorTetheringManager::CreateFromConnectionProfileWithTargetAdapter(&profile, &adapter)
                    .context("Windows rejected the selected hotspot adapter")?
            }
            None => NetworkOperatorTetheringManager::CreateFromConnectionProfile(&profile)
                .context("failed to create the Windows tethering manager")?,
        };

        if manager
            .TetheringOperationalState()
            .context("failed to read Windows hotspot state")?
            != TetheringOperationalState::Off
        {
            bail!("a Windows mobile hotspot is already active; turn it off first");
        }

        let original = manager
            .GetCurrentAccessPointConfiguration()
            .context("failed to read the current Windows hotspot configuration")?;
        let original = clone_access_point(&original)?;
        let restore_no_connections_timeout =
            NetworkOperatorTetheringManager::IsNoConnectionsTimeoutEnabled().unwrap_or(false);
        let _ = NetworkOperatorTetheringManager::DisableNoConnectionsTimeout();

        let mut session = Self {
            manager,
            original,
            restore_no_connections_timeout,
            config: config.clone(),
            tun_device: tun_device.to_owned(),
            configured_band: config.band.clone(),
            ap_baseline: ipv4_adapter_baseline(),
            ap_adapter: None,
            gateway: None,
            clients: 0,
            devices: Vec::new(),
            force_auto_band: false,
            cleanup_done: false,
        };

        match session.start_inner() {
            Ok(()) => Ok(session),
            Err(error) => {
                let _ = session.cleanup();
                Err(error)
            }
        }
    }

    fn start_inner(&mut self) -> Result<()> {
        self.configure_access_point()?;

        let result = self
            .manager
            .StartTetheringAsync()
            .context("Windows rejected the hotspot start request")?
            .join()
            .context("Windows hotspot start failed")?;
        let status = result.Status().context("failed to read the hotspot start result")?;

        // Automatic band selection prefers 5 GHz; retry once with Auto when the
        // radio or driver rejects that band before any AP is live.
        if status != TetheringOperationStatus::Success
            && self.config.band == "auto"
            && self.configured_band == "5"
            && matches!(
                status,
                TetheringOperationStatus::WiFiDeviceOff
                    | TetheringOperationStatus::RadioRestriction
                    | TetheringOperationStatus::BandInterference
            )
            && self.manager.TetheringOperationalState()? == TetheringOperationalState::Off
        {
            self.configured_band = "auto".to_owned();
            self.force_auto_band = true;
            self.configure_access_point()?;
            let retry = self
                .manager
                .StartTetheringAsync()
                .context("Windows rejected the hotspot retry")?
                .join()
                .context("Windows hotspot retry failed")?;
            let retry_status = retry.Status().context("failed to read the hotspot retry result")?;
            if retry_status != TetheringOperationStatus::Success {
                bail!("Windows tethering status: {retry_status:?}");
            }
        } else if status != TetheringOperationStatus::Success {
            bail!("Windows tethering status: {status:?}");
        }

        self.await_ready()?;
        Ok(())
    }

    fn configure_access_point(&mut self) -> Result<()> {
        let configuration = NetworkOperatorTetheringAccessPointConfiguration::new()
            .context("failed to create a hotspot configuration")?;
        configuration.SetSsid(&HSTRING::from(self.config.ssid.as_str()))?;
        configuration.SetPassphrase(&HSTRING::from(self.config.password.as_str()))?;

        let band = self.band_value()?;
        configuration.SetBand(band)?;
        if !configuration.IsBandSupported(band).unwrap_or(false) {
            if self.config.band != "auto" {
                bail!("the Wi-Fi adapter does not support the selected hotspot band");
            }
            self.configured_band = "auto".to_owned();
            configuration.SetBand(TetheringWiFiBand::Auto)?;
        }

        self.manager
            .ConfigureAccessPointAsync(&configuration)
            .context("Windows rejected the hotspot configuration")?
            .join()
            .context("Windows hotspot configuration failed")?;
        Ok(())
    }

    fn band_value(&mut self) -> Result<TetheringWiFiBand> {
        let requested = match self.config.band.as_str() {
            "2.4" => TetheringWiFiBand::TwoPointFourGigahertz,
            "5" => TetheringWiFiBand::FiveGigahertz,
            "auto" => TetheringWiFiBand::Auto,
            _ => bail!("unsupported hotspot band"),
        };

        if self.config.band == "auto" && !self.force_auto_band {
            // Use 5 GHz when the radio supports it; the start path falls back to
            // Auto when Windows reports a radio restriction.
            let probe = NetworkOperatorTetheringAccessPointConfiguration::new()?;
            if probe.IsBandSupported(TetheringWiFiBand::FiveGigahertz).unwrap_or(false) {
                self.configured_band = "5".to_owned();
                return Ok(TetheringWiFiBand::FiveGigahertz);
            }
        }
        Ok(requested)
    }

    fn await_ready(&mut self) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if self.manager.TetheringOperationalState()? == TetheringOperationalState::On
                && let Some(adapter) = find_ap_adapter(&self.ap_baseline)
            {
                self.ap_adapter = Some(adapter.name.clone());
                self.gateway = adapter
                    .ipv4
                    .iter()
                    .find(|address| address.octets()[..3] == ICS_DEFAULT_PREFIX)
                    .or_else(|| adapter.ipv4.first())
                    .map(|address| address.to_string());
                return Ok(());
            }

            if Instant::now() >= deadline {
                bail!("Windows hotspot did not become ready; the AP adapter has no IPv4 gateway");
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    }

    fn run(&mut self, commands: &Receiver<WorkerCommand>, publisher: &Publisher) {
        loop {
            match commands.recv_timeout(STATUS_POLL) {
                Ok(WorkerCommand::Stop(reply)) => {
                    let result = self.cleanup();
                    let _ = reply.send(result);
                    return;
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    let _ = self.cleanup();
                    return;
                }
            }

            match self.poll() {
                Ok(Some(status)) => {
                    let stopped = status.state != HotspotState::Running;
                    publisher(status);
                    if stopped {
                        let _ = self.cleanup();
                        return;
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    publisher(HotspotStatus {
                        state: HotspotState::Failed,
                        ssid: self.config.ssid.clone(),
                        band: self.configured_band.clone(),
                        message: Some(format!("{error:#}")),
                        ..HotspotStatus::default()
                    });
                    let _ = self.cleanup();
                    return;
                }
            }
        }
    }

    fn poll(&mut self) -> Result<Option<HotspotStatus>> {
        if self.manager.TetheringOperationalState()? != TetheringOperationalState::On {
            return Ok(Some(HotspotStatus {
                state: HotspotState::Stopped,
                ssid: self.config.ssid.clone(),
                band: self.configured_band.clone(),
                message: Some("Windows turned the mobile hotspot off; the core and routing are unchanged".to_owned()),
                ..HotspotStatus::default()
            }));
        }

        if !tun_adapter_up(&self.tun_device) {
            return Ok(Some(HotspotStatus {
                state: HotspotState::Stopped,
                ssid: self.config.ssid.clone(),
                band: self.configured_band.clone(),
                message: Some("TUN stopped, so the hotspot was closed and its uplink released".to_owned()),
                ..HotspotStatus::default()
            }));
        }

        self.refresh_clients();
        Ok(Some(self.status()))
    }

    fn refresh_clients(&mut self) {
        self.clients = self.manager.ClientCount().unwrap_or(0);

        let mut devices = Vec::new();
        if let Ok(clients) = self.manager.GetTetheringClients() {
            for client in clients {
                let mac = client
                    .MacAddress()
                    .map(|address| address.to_string())
                    .unwrap_or_default();
                let mut hosts = Vec::new();
                if let Ok(names) = client.HostNames() {
                    for name in names {
                        if let Ok(name) = name.DisplayName() {
                            hosts.push(name.to_string());
                        }
                    }
                }
                devices.push(HotspotDevice { mac, hosts });
            }
        }
        self.devices = devices;
    }

    fn status(&self) -> HotspotStatus {
        HotspotStatus {
            state: HotspotState::Running,
            ssid: self.config.ssid.clone(),
            band: self.configured_band.clone(),
            clients: self.clients,
            gateway: self.gateway.clone(),
            adapter: self.ap_adapter.clone(),
            message: None,
            devices: self.devices.clone(),
            updated_at: 0,
        }
    }

    fn cleanup(&mut self) -> Result<()> {
        if self.cleanup_done {
            return Ok(());
        }
        self.cleanup_done = true;

        let mut failures = Vec::new();
        if let Err(error) = stop_tethering(&self.manager) {
            failures.push(format!("stopping the hotspot failed: {error:#}"));
        }
        if let Err(error) = self
            .manager
            .ConfigureAccessPointAsync(&self.original)
            .map_err(|error| anyhow!("{error}"))
            .and_then(|action| action.join().map_err(|error| anyhow!("{error}")))
        {
            failures.push(format!(
                "restoring the previous hotspot configuration failed: {error:#}"
            ));
        }
        if self.restore_no_connections_timeout {
            let _ = NetworkOperatorTetheringManager::EnableNoConnectionsTimeout();
        }

        if failures.is_empty() {
            Ok(())
        } else {
            bail!("{}", failures.join("; "))
        }
    }
}

fn clone_access_point(
    configuration: &NetworkOperatorTetheringAccessPointConfiguration,
) -> Result<NetworkOperatorTetheringAccessPointConfiguration> {
    let copy = NetworkOperatorTetheringAccessPointConfiguration::new()?;
    if let Ok(ssid) = configuration.Ssid() {
        copy.SetSsid(&ssid)?;
    }
    if let Ok(passphrase) = configuration.Passphrase() {
        copy.SetPassphrase(&passphrase)?;
    }
    if let Ok(band) = configuration.Band()
        && copy.IsBandSupported(band).unwrap_or(false)
    {
        copy.SetBand(band)?;
    }
    Ok(copy)
}

fn stop_tethering(manager: &NetworkOperatorTetheringManager) -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while manager.TetheringOperationalState()? == TetheringOperationalState::InTransition && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
    }
    if manager.TetheringOperationalState()? == TetheringOperationalState::Off {
        return Ok(());
    }

    let result = manager
        .StopTetheringAsync()
        .context("Windows rejected the hotspot stop request")?
        .join()
        .context("Windows hotspot stop failed")?;
    let status = result.Status().context("failed to read the hotspot stop result")?;
    if status != TetheringOperationStatus::Success
        && manager.TetheringOperationalState()? != TetheringOperationalState::Off
    {
        bail!("Windows tethering status: {status:?}");
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while manager.TetheringOperationalState()? != TetheringOperationalState::Off && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
    }
    if manager.TetheringOperationalState()? != TetheringOperationalState::Off {
        bail!("Windows has not confirmed that the hotspot is off");
    }
    Ok(())
}

fn find_profile(guid: GUID) -> Result<ConnectionProfile> {
    if let Ok(profiles) = NetworkInformation::GetConnectionProfiles() {
        for profile in profiles {
            if let Ok(adapter) = profile.NetworkAdapter()
                && adapter.NetworkAdapterId().is_ok_and(|id| id == guid)
            {
                return Ok(profile);
            }
        }
    }

    // Windows 10 can omit the TUN from the global profile list while host IP
    // information still exposes its adapter; ask that same adapter.
    if let Ok(names) = NetworkInformation::GetHostNames() {
        for name in names {
            let Ok(information) = name.IPInformation() else {
                continue;
            };
            let Ok(adapter) = information.NetworkAdapter() else {
                continue;
            };
            if !adapter.NetworkAdapterId().is_ok_and(|id| id == guid) {
                continue;
            }
            let Ok(operation) = adapter.GetConnectedProfileAsync() else {
                continue;
            };
            if let Ok(profile) = operation.join() {
                return Ok(profile);
            }
        }
    }

    bail!("Windows did not expose the TUN connection profile; restart TUN and retry")
}

fn resolve_network_adapter(guid: GUID) -> Result<NetworkAdapter> {
    if let Ok(names) = NetworkInformation::GetHostNames() {
        for name in names {
            let Ok(information) = name.IPInformation() else {
                continue;
            };
            let Ok(adapter) = information.NetworkAdapter() else {
                continue;
            };
            if adapter.NetworkAdapterId().is_ok_and(|id| id == guid) {
                return Ok(adapter);
            }
        }
    }

    if let Ok(profiles) = NetworkInformation::GetConnectionProfiles() {
        for profile in profiles {
            let Ok(adapter) = profile.NetworkAdapter() else {
                continue;
            };
            if adapter.NetworkAdapterId().is_ok_and(|id| id == guid) {
                return Ok(adapter);
            }
        }
    }

    // A dedicated, disconnected radio has no host name or profile.
    if let Ok(operation) = WiFiAdapter::FindAllAdaptersAsync()
        && let Ok(radios) = operation.join()
    {
        for radio in radios {
            let Ok(adapter) = radio.NetworkAdapter() else {
                continue;
            };
            if adapter.NetworkAdapterId().is_ok_and(|id| id == guid) {
                return Ok(adapter);
            }
        }
    }

    bail!("the selected Wi-Fi adapter is not available; enable it or use automatic selection")
}

fn find_tun_adapter(device: &str) -> Result<AdapterInfo> {
    enumerate_adapters()?
        .into_iter()
        .find(|adapter| adapter.up && adapter.name.eq_ignore_ascii_case(device))
        .with_context(|| format!("TUN adapter {device:?} is not up; start TUN mode first"))
}

pub(crate) fn tun_adapter_up(device: &str) -> bool {
    enumerate_adapters()
        .map(|adapters| {
            adapters
                .iter()
                .any(|adapter| adapter.up && adapter.name.eq_ignore_ascii_case(device))
        })
        .unwrap_or(false)
}

pub(crate) fn list_adapters() -> Result<Vec<HotspotAdapter>> {
    let mut adapters: Vec<HotspotAdapter> = enumerate_adapters()?
        .into_iter()
        .filter(|adapter| adapter.if_type == IF_TYPE_IEEE80211)
        .map(|adapter| HotspotAdapter {
            id: adapter.guid_text,
            name: adapter.name,
            description: adapter.description,
            status: if adapter.up { "up" } else { "down" }.to_owned(),
        })
        .collect();
    adapters.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(adapters)
}

fn find_ap_adapter(baseline: &HashSet<GUID>) -> Option<AdapterInfo> {
    let adapters = enumerate_adapters().ok()?;
    let mut candidates: Vec<AdapterInfo> = adapters
        .into_iter()
        .filter(|adapter| adapter.up && adapter.ipv4.iter().any(is_usable_ipv4))
        .collect();
    for candidate in &mut candidates {
        candidate.ipv4.retain(is_usable_ipv4);
    }

    if let Some(adapter) = candidates
        .iter()
        .find(|adapter| !baseline.contains(&adapter.guid) && adapter.if_type == IF_TYPE_IEEE80211)
    {
        return Some(adapter.clone());
    }
    candidates.into_iter().find(|adapter| {
        adapter
            .ipv4
            .iter()
            .any(|address| address.octets()[..3] == ICS_DEFAULT_PREFIX)
    })
}

const fn is_usable_ipv4(address: &Ipv4Addr) -> bool {
    let octets = address.octets();
    octets[0] != 0 && !address.is_loopback() && !address.is_unspecified() && !(octets[0] == 169 && octets[1] == 254)
}

fn ipv4_adapter_baseline() -> HashSet<GUID> {
    enumerate_adapters()
        .map(|adapters| {
            adapters
                .into_iter()
                .filter(|adapter| adapter.up && adapter.ipv4.iter().any(is_usable_ipv4))
                .map(|adapter| adapter.guid)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_guid(text: &str) -> Result<GUID> {
    let trimmed = text.trim_matches(|character| character == '{' || character == '}');
    let digits: std::string::String = trimmed.chars().filter(|character| *character != '-').collect();
    if digits.len() != 32 {
        bail!("invalid adapter identifier");
    }
    let value = u128::from_str_radix(&digits, 16).context("invalid adapter identifier")?;
    Ok(GUID::from_u128(value))
}

#[derive(Clone)]
struct AdapterInfo {
    guid: GUID,
    guid_text: std::string::String,
    name: std::string::String,
    description: std::string::String,
    if_type: u32,
    up: bool,
    ipv4: Vec<Ipv4Addr>,
}

fn enumerate_adapters() -> Result<Vec<AdapterInfo>> {
    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size: u32 = 16 * 1024;
    let mut buffer: Vec<u64> = Vec::new();

    loop {
        let words = (size as usize).div_ceil(std::mem::size_of::<u64>());
        buffer.resize(words, 0);
        let result = unsafe {
            GetAdaptersAddresses(
                AF_UNSPEC as u32,
                flags,
                std::ptr::null(),
                buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            )
        };
        match result {
            NO_ERROR => break,
            ERROR_BUFFER_OVERFLOW => {}
            code => bail!("GetAdaptersAddresses failed with error {code}"),
        }
    }

    let mut adapters = Vec::new();
    let mut current = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    while !current.is_null() {
        // SAFETY: the buffer holds a linked list owned by GetAdaptersAddresses
        // for the lifetime of `buffer`.
        let adapter = unsafe { &*current };
        let name = unsafe { wide_ptr_to_string(adapter.FriendlyName) };
        let description = unsafe { wide_ptr_to_string(adapter.Description) };
        let guid_text = unsafe { ansi_ptr_to_string(adapter.AdapterName as *const i8) };

        if let Some(guid) = guid_text.as_deref().and_then(|text| parse_guid(text).ok()) {
            let mut ipv4 = Vec::new();
            let mut unicast = adapter.FirstUnicastAddress;
            while !unicast.is_null() {
                // SAFETY: same linked list as above.
                let address = unsafe { &*unicast };
                let socket = address.Address.lpSockaddr;
                if !socket.is_null() && unsafe { (*socket).sa_family } == AF_INET {
                    let socket = unsafe { &*(socket as *const SOCKADDR_IN) };
                    let octets = unsafe { socket.sin_addr.S_un.S_addr }.to_ne_bytes();
                    ipv4.push(Ipv4Addr::from(octets));
                }
                unicast = address.Next;
            }

            adapters.push(AdapterInfo {
                guid,
                guid_text: guid_text.unwrap_or_default(),
                name,
                description,
                if_type: adapter.IfType,
                up: adapter.OperStatus == IF_OPER_STATUS_UP,
                ipv4,
            });
        }

        current = adapter.Next;
    }

    Ok(adapters)
}

unsafe fn wide_ptr_to_string(pointer: *mut u16) -> std::string::String {
    if pointer.is_null() {
        return std::string::String::new();
    }
    let mut length = 0;
    while unsafe { *pointer.add(length) } != 0 {
        length += 1;
    }
    std::string::String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) })
}

unsafe fn ansi_ptr_to_string(pointer: *const i8) -> Option<std::string::String> {
    if pointer.is_null() {
        return None;
    }
    Some(unsafe { CStr::from_ptr(pointer) }.to_string_lossy().into_owned())
}
