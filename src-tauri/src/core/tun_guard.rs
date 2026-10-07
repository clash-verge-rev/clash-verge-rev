//! Opt-in, temporary IPv4 forwarding protection for an explicitly pinned Windows uplink.

use anyhow::Result;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InterfaceUnavailableReason {
    Missing,
    Disconnected,
}

#[derive(Debug)]
pub(crate) struct InterfaceUnavailable {
    pub(crate) name: String,
    pub(crate) reason: InterfaceUnavailableReason,
}

impl std::fmt::Display for InterfaceUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.reason {
            InterfaceUnavailableReason::Missing => {
                write!(formatter, "The selected TUN interface was not found: {}", self.name)
            }
            InterfaceUnavailableReason::Disconnected => write!(
                formatter,
                "The selected TUN interface is not a connected IPv4 uplink: {}",
                self.name
            ),
        }
    }
}

impl std::error::Error for InterfaceUnavailable {}

pub(crate) fn interface_unavailable(error: &anyhow::Error) -> Option<&InterfaceUnavailable> {
    error.downcast_ref()
}

static PENDING_RESTORE_NOTICE: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);

pub(crate) fn record_restore_notice(detail: String) {
    *PENDING_RESTORE_NOTICE.lock() = Some(detail);
}

pub(crate) fn take_restore_notice() -> Option<String> {
    PENDING_RESTORE_NOTICE.lock().take()
}

#[cfg(windows)]
fn clear_restore_notice() {
    *PENDING_RESTORE_NOTICE.lock() = None;
}

#[cfg(any(windows, test))]
mod state {
    use super::{InterfaceUnavailable, InterfaceUnavailableReason};
    use anyhow::{Result, bail};
    use serde::{Deserialize, Serialize};

    #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
    pub(super) struct Target {
        pub name: String,
        pub guid: [u8; 16],
    }

    pub(super) struct Adapter {
        pub target: Target,
        pub forwarding: bool,
        pub hardware: bool,
        pub ethernet_or_wifi: bool,
        pub up: bool,
        pub uplink: bool,
    }

    impl Adapter {
        pub fn validate(&self) -> Result<()> {
            if !self.hardware || !self.ethernet_or_wifi {
                bail!(
                    "TUN compatibility protection requires a physical Ethernet or Wi-Fi interface: {}",
                    self.target.name
                );
            }
            if !self.up || !self.uplink {
                return Err(InterfaceUnavailable {
                    name: self.target.name.clone(),
                    reason: InterfaceUnavailableReason::Disconnected,
                }
                .into());
            }
            Ok(())
        }
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    pub(super) struct Record {
        pub target: Target,
        pub original_forwarding: bool,
        pub session: String,
    }

    pub(super) trait Backend {
        fn adapter(&mut self, name: &str) -> Result<Adapter>;
        fn inspect(&mut self, target: &Target) -> Result<Option<Adapter>>;
        fn session(&mut self) -> Result<String>;
        fn same_session(&mut self, session: &str) -> Result<bool>;
        fn can_change(&mut self) -> Result<()>;
        fn change(&mut self, target: &Target, expected: bool, value: bool) -> Result<bool>;
        fn save(&mut self, records: &[Record]) -> Result<()>;
        fn archive(&mut self, records: &[Record]) -> Result<()>;
    }

    struct Pending {
        id: u64,
        target: Option<Target>,
        added: Option<Target>,
    }

    #[derive(Default)]
    pub(super) struct State {
        pub records: Vec<Record>,
        pub active: Option<Target>,
        pending: Option<Pending>,
        next_id: u64,
    }

    impl State {
        pub fn preflight(&self, backend: &mut impl Backend, name: Option<&str>) -> Result<()> {
            let Some(name) = name else {
                return Ok(());
            };
            if self.pending.is_some() {
                bail!("A TUN compatibility protection transaction is already active");
            }
            if name.trim().is_empty() || name.contains('\0') {
                bail!("TUN compatibility protection requires an explicitly locked outbound interface");
            }
            let adapter = backend.adapter(name)?;
            adapter.validate()?;
            if adapter.forwarding
                && self
                    .records
                    .iter()
                    .any(|record| record.target.guid == adapter.target.guid)
            {
                bail!(
                    "IPv4 forwarding on {} changed outside TUN compatibility protection; review its network sharing settings",
                    name
                );
            }
            let mut needs_change = adapter.forwarding;
            for record in &self.records {
                if self
                    .active
                    .as_ref()
                    .is_some_and(|active| active.guid == record.target.guid)
                {
                    continue;
                }
                let current = backend.inspect(&record.target)?.ok_or_else(|| {
                    anyhow::anyhow!(
                        "Forwarding restoration is pending because interface {} is unavailable",
                        record.target.name
                    )
                })?;
                if !current.forwarding {
                    if !current.hardware || !current.ethernet_or_wifi {
                        bail!("The protected interface no longer identifies the original physical uplink");
                    }
                    needs_change = true;
                }
            }
            if needs_change {
                backend.can_change()?;
            }
            Ok(())
        }

        pub fn prepare(&mut self, backend: &mut impl Backend, name: Option<&str>) -> Result<u64> {
            if self.pending.is_some() {
                bail!("A TUN compatibility protection transaction is already active");
            }
            // Failed cleanup cannot block switching TUN off, but must not accumulate across uplink switches.
            if name.is_some() {
                self.restore_except(backend, self.active.clone().as_ref())?;
            }
            let mut added = None;
            let target = match name {
                Some(name) => {
                    if name.trim().is_empty() || name.contains('\0') {
                        bail!("TUN compatibility protection requires an explicitly locked outbound interface");
                    }
                    let adapter = backend.adapter(name)?;
                    adapter.validate()?;
                    let already_owned = self
                        .records
                        .iter()
                        .any(|record| record.target.guid == adapter.target.guid);
                    if already_owned && adapter.forwarding {
                        bail!(
                            "IPv4 forwarding on {} changed outside TUN compatibility protection; review its network sharing settings",
                            name
                        );
                    }
                    if adapter.forwarding {
                        let session = backend.session()?;
                        self.records.push(Record {
                            target: adapter.target.clone(),
                            original_forwarding: adapter.forwarding,
                            session,
                        });
                        if let Err(error) = backend.save(&self.records) {
                            self.records.pop();
                            return Err(error);
                        }
                        match backend.change(&adapter.target, true, false) {
                            Ok(true) => added = Some(adapter.target.clone()),
                            Ok(false) => {
                                // Another writer won the race; its value is not ours to restore.
                                self.records.pop();
                                backend.save(&self.records)?;
                            }
                            Err(error) => {
                                let cleanup = self.restore_except(backend, self.active.clone().as_ref());
                                return Err(match cleanup {
                                    Ok(()) => error,
                                    Err(cleanup) => {
                                        error.context(format!("TUN forwarding rollback is pending: {cleanup:#}"))
                                    }
                                });
                            }
                        }
                    }
                    Some(adapter.target)
                }
                None => None,
            };
            self.next_id += 1;
            self.pending = Some(Pending {
                id: self.next_id,
                target,
                added,
            });
            Ok(self.next_id)
        }

        pub fn commit(&mut self, backend: &mut impl Backend, id: u64) -> Result<()> {
            let pending = self.take_pending(id)?;
            self.active = pending.target;
            // The core has already accepted the new config. Cleanup errors cannot undo its guard.
            self.restore_except(backend, self.active.clone().as_ref())
        }

        pub fn rollback(&mut self, backend: &mut impl Backend, id: u64) -> Result<()> {
            let pending = self.take_pending(id)?;
            if let Some(added) = pending.added {
                self.restore_one(backend, &added)?;
            }
            Ok(())
        }

        pub fn retain(&mut self, id: u64) -> Result<()> {
            self.active = self.take_pending(id)?.target;
            Ok(())
        }

        fn take_pending(&mut self, id: u64) -> Result<Pending> {
            if self.pending.as_ref().is_none_or(|pending| pending.id != id) {
                bail!("TUN compatibility protection transaction is no longer current");
            }
            self.pending
                .take()
                .ok_or_else(|| anyhow::anyhow!("TUN compatibility protection transaction is no longer current"))
        }

        fn restore_one(&mut self, backend: &mut impl Backend, target: &Target) -> Result<()> {
            let Some(index) = self.records.iter().position(|record| record.target.guid == target.guid) else {
                return Ok(());
            };
            let record = self.records[index].clone();
            let current = backend.inspect(&record.target)?.ok_or_else(|| {
                anyhow::anyhow!(
                    "Forwarding restoration is pending because interface {} is unavailable",
                    record.target.name
                )
            })?;
            if !current.forwarding {
                backend.change(&record.target, false, record.original_forwarding)?;
            }
            // If the value no longer matches ours, preserve the other writer's change.
            let record = self.records.remove(index);
            if let Err(error) = backend.save(&self.records) {
                self.records.insert(index, record);
                return Err(error);
            }
            Ok(())
        }

        fn restore_except(&mut self, backend: &mut impl Backend, keep: Option<&Target>) -> Result<()> {
            let targets = self
                .records
                .iter()
                .filter(|record| keep.is_none_or(|keep| keep.guid != record.target.guid))
                .map(|record| record.target.clone())
                .collect::<Vec<_>>();
            let mut errors = Vec::new();
            for target in targets {
                if let Err(error) = self.restore_one(backend, &target) {
                    errors.push(format!("{error:#}"));
                }
            }
            if !errors.is_empty() {
                bail!("{}", errors.join("; "));
            }
            Ok(())
        }

        pub fn restore(&mut self, backend: &mut impl Backend) -> Result<()> {
            if self.pending.is_some() {
                bail!("Cannot restore forwarding during a TUN compatibility transaction");
            }
            self.active = None;
            self.restore_except(backend, None)
        }

        pub fn recover(&mut self, backend: &mut impl Backend) -> Result<()> {
            let mut stale = Vec::new();
            for record in &self.records {
                if !backend.same_session(&record.session)? {
                    stale.push(record.clone());
                }
            }
            if !stale.is_empty() {
                // ActiveStore may now contain a new boot's legitimate settings. Keep evidence only.
                backend.archive(&stale)?;
                self.records
                    .retain(|record| !stale.iter().any(|old| old.target.guid == record.target.guid));
                backend.save(&self.records)?;
            }
            self.restore(backend)
        }

        pub fn check(&self, backend: &mut impl Backend) -> Result<()> {
            let Some(target) = &self.active else {
                return Ok(());
            };
            let adapter = backend
                .inspect(target)?
                .ok_or_else(|| anyhow::anyhow!("Protected TUN uplink {} is unavailable", target.name))?;
            adapter.validate()?;
            if adapter.target.name != target.name {
                bail!("Protected TUN uplink {} was renamed; select it again", target.name);
            }
            if adapter.forwarding {
                bail!(
                    "IPv4 forwarding on {} was enabled outside TUN compatibility protection",
                    target.name
                );
            }
            Ok(())
        }

        pub const fn idle(&self) -> bool {
            self.active.is_none() && self.pending.is_none() && self.records.is_empty()
        }
    }
}

#[cfg(windows)]
mod native {
    use super::state::{Adapter, Backend, Record, State, Target};
    use super::{InterfaceUnavailable, InterfaceUnavailableReason};
    use anyhow::{Context as _, Result, bail};
    use clash_verge_logging::{Type, logging};
    use parking_lot::Mutex;
    use serde::{Deserialize, Serialize};
    use std::{
        fs::{self, File, OpenOptions},
        io::{ErrorKind, Write as _},
        os::windows::{
            fs::OpenOptionsExt as _,
            io::{FromRawHandle as _, OwnedHandle},
        },
        path::{Path, PathBuf},
        sync::LazyLock,
    };
    use windows_sys::{
        Win32::{
            Foundation::{
                ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, ERROR_FILE_NOT_FOUND, ERROR_INVALID_PARAMETER,
                ERROR_NOT_FOUND, GetLastError,
            },
            NetworkManagement::{
                IpHelper::{
                    ConvertInterfaceAliasToLuid, ConvertInterfaceGuidToLuid, FreeMibTable, GetIfEntry2, GetIfTable2,
                    GetIpForwardTable2, GetIpInterfaceEntry, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211, MIB_IF_ROW2,
                    MIB_IF_TABLE2, MIB_IPFORWARD_TABLE2, MIB_IPINTERFACE_ROW, SetIpInterfaceEntry,
                },
                Ndis::{IfOperStatusUp, NET_LUID_LH},
            },
            Networking::WinSock::AF_INET,
            Storage::FileSystem::{MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW},
            System::Threading::CreateEventW,
        },
        core::GUID,
    };
    use winreg::{
        RegKey,
        enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_64KEY, KEY_WRITE, REG_OPTION_VOLATILE},
    };

    const SESSION_KEY: &str = r"SOFTWARE\ClashVergeRevTunGuardSession-";
    const JOURNAL_FILE: &str = "tun-compatibility-guard.json";

    #[derive(Serialize, Deserialize)]
    struct Journal {
        version: u8,
        records: Vec<Record>,
    }

    struct NativeBackend {
        path: PathBuf,
    }

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt as _;
        value.encode_wide().chain(Some(0)).collect()
    }

    fn identity(guid: GUID) -> [u8; 16] {
        let mut bytes = [0; 16];
        bytes[..4].copy_from_slice(&guid.data1.to_be_bytes());
        bytes[4..6].copy_from_slice(&guid.data2.to_be_bytes());
        bytes[6..8].copy_from_slice(&guid.data3.to_be_bytes());
        bytes[8..].copy_from_slice(&guid.data4);
        bytes
    }

    const fn guid(bytes: [u8; 16]) -> GUID {
        let [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p] = bytes;
        GUID {
            data1: u32::from_be_bytes([a, b, c, d]),
            data2: u16::from_be_bytes([e, f]),
            data3: u16::from_be_bytes([g, h]),
            data4: [i, j, k, l, m, n, o, p],
        }
    }

    fn check_code(code: u32, operation: &str) -> Result<()> {
        if code == 0 {
            return Ok(());
        }
        if code == ERROR_ACCESS_DENIED {
            bail!(
                "TUN compatibility protection requires running Clash Verge as administrator; {operation} was denied (service mode alone cannot grant this permission)"
            );
        }
        Err(std::io::Error::from_raw_os_error(code as i32))
            .with_context(|| format!("TUN compatibility protection: {operation}"))
    }

    fn require_admin() -> Result<()> {
        use deelevate::{PrivilegeLevel, Token};
        if Token::with_current_process()?.privilege_level()? == PrivilegeLevel::NotPrivileged {
            bail!(
                "TUN compatibility protection requires running Clash Verge as administrator; service mode alone cannot grant this permission"
            );
        }
        Ok(())
    }

    fn ip_row(luid: NET_LUID_LH) -> Result<MIB_IPINTERFACE_ROW> {
        let mut row = MIB_IPINTERFACE_ROW {
            Family: AF_INET,
            InterfaceLuid: luid,
            ..Default::default()
        };
        // SAFETY: row is a writable IPv4 query initialized with a valid interface LUID.
        check_code(unsafe { GetIpInterfaceEntry(&mut row) }, "query IPv4 interface")?;
        Ok(row)
    }

    fn is_uplink(luid: NET_LUID_LH) -> Result<bool> {
        let mut table = std::ptr::null_mut();
        // SAFETY: table receives a system-allocated route table, freed below.
        check_code(unsafe { GetIpForwardTable2(AF_INET, &mut table) }, "query IPv4 routes")?;
        struct Routes(*mut MIB_IPFORWARD_TABLE2);
        impl Drop for Routes {
            fn drop(&mut self) {
                // SAFETY: this is the allocation returned by GetIpForwardTable2.
                unsafe { FreeMibTable(self.0.cast()) };
            }
        }
        let table = Routes(table);
        if table.0.is_null() {
            bail!("Windows returned no IPv4 route table");
        }
        // SAFETY: the allocation contains NumEntries rows; union Value and AF_INET NextHop are valid.
        let result = unsafe {
            std::slice::from_raw_parts((*table.0).Table.as_ptr(), (*table.0).NumEntries as usize)
                .iter()
                .any(|route| {
                    route.InterfaceLuid.Value == luid.Value
                        && route.DestinationPrefix.PrefixLength == 0
                        && !route.Loopback
                        && route.ValidLifetime != 0
                        && route.NextHop.si_family == AF_INET
                        && route.NextHop.Ipv4.sin_addr.S_un.S_addr != 0
                })
        };
        Ok(result)
    }

    fn inspect_luid(luid: NET_LUID_LH) -> Result<Adapter> {
        let mut row = MIB_IF_ROW2 {
            InterfaceLuid: luid,
            ..Default::default()
        };
        // SAFETY: row is writable and identifies a system interface by LUID.
        check_code(unsafe { GetIfEntry2(&mut row) }, "query network interface")?;
        let name_end = row
            .Alias
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(row.Alias.len());
        let name = String::from_utf16(&row.Alias[..name_end]).context("network interface alias is invalid UTF-16")?;
        let ipv4 = ip_row(luid)?;
        let flags = row.InterfaceAndOperStatusFlags._bitfield;
        Ok(Adapter {
            target: Target {
                name,
                guid: identity(row.InterfaceGuid),
            },
            forwarding: ipv4.ForwardingEnabled,
            hardware: flags & 1 != 0 && flags & (2 | 128) == 0,
            ethernet_or_wifi: matches!(row.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211),
            up: row.OperStatus == IfOperStatusUp && ipv4.Connected,
            uplink: is_uplink(luid)?,
        })
    }

    fn interface_alias_missing(name: &str) -> Result<bool> {
        let mut table = std::ptr::null_mut();
        // SAFETY: table receives a system-allocated interface table, freed below.
        check_code(unsafe { GetIfTable2(&mut table) }, "query network interfaces")?;
        struct Interfaces(*mut MIB_IF_TABLE2);
        impl Drop for Interfaces {
            fn drop(&mut self) {
                // SAFETY: this is the allocation returned by GetIfTable2.
                unsafe { FreeMibTable(self.0.cast()) };
            }
        }
        let table = Interfaces(table);
        if table.0.is_null() {
            bail!("Windows returned no network interface table");
        }
        // SAFETY: the allocation contains NumEntries aligned MIB_IF_ROW2 entries.
        let rows = unsafe { std::slice::from_raw_parts((*table.0).Table.as_ptr(), (*table.0).NumEntries as usize) };
        let folded_name = name.to_lowercase();
        for row in rows {
            let end = row
                .Alias
                .iter()
                .position(|value| *value == 0)
                .unwrap_or(row.Alias.len());
            let alias = String::from_utf16(&row.Alias[..end]).context("network interface alias is invalid UTF-16")?;
            if alias == name {
                return Ok(false);
            }
            if alias.to_lowercase() == folded_name {
                bail!("The locked interface name must exactly match its Windows alias");
            }
        }
        Ok(true)
    }

    fn target_luid(target: &Target) -> Result<Option<NET_LUID_LH>> {
        let mut luid = NET_LUID_LH::default();
        // SAFETY: target contains a complete GUID and luid is writable.
        let code = unsafe { ConvertInterfaceGuidToLuid(&guid(target.guid), &mut luid) };
        if code == ERROR_FILE_NOT_FOUND || code == ERROR_NOT_FOUND {
            return Ok(None);
        }
        check_code(code, "resolve protected interface GUID")?;
        Ok(Some(luid))
    }

    fn atomic_write(path: &Path, journal: &Journal) -> Result<()> {
        let parent = path.parent().context("TUN guard journal has no parent")?;
        fs::create_dir_all(parent)?;
        let temporary = parent.join(format!(".tun-guard-{}.tmp", nanoid::nanoid!()));
        let result = (|| {
            let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
            file.write_all(&serde_json::to_vec(journal)?)?;
            file.sync_all()?;
            drop(file);
            // SAFETY: both paths are NUL-terminated; replace is atomic on the same filesystem.
            if unsafe {
                MoveFileExW(
                    wide(temporary.as_os_str()).as_ptr(),
                    wide(path.as_os_str()).as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error()).context("publish TUN guard journal");
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    impl Backend for NativeBackend {
        fn adapter(&mut self, name: &str) -> Result<Adapter> {
            let mut luid = NET_LUID_LH::default();
            // SAFETY: name is validated against embedded NUL before this call and luid is writable.
            let code = unsafe { ConvertInterfaceAliasToLuid(wide(std::ffi::OsStr::new(name)).as_ptr(), &mut luid) };
            if matches!(code, ERROR_FILE_NOT_FOUND | ERROR_NOT_FOUND | ERROR_INVALID_PARAMETER)
                && interface_alias_missing(name)?
            {
                return Err(InterfaceUnavailable {
                    name: name.to_owned(),
                    reason: InterfaceUnavailableReason::Missing,
                }
                .into());
            }
            check_code(code, "resolve locked interface")?;
            let adapter = inspect_luid(luid)?;
            if adapter.target.name != name {
                bail!("The locked interface name must exactly match its Windows alias");
            }
            Ok(adapter)
        }

        fn inspect(&mut self, target: &Target) -> Result<Option<Adapter>> {
            let adapter = target_luid(target)?.map(inspect_luid).transpose()?;
            if adapter
                .as_ref()
                .is_some_and(|adapter| adapter.target.guid != target.guid)
            {
                bail!("The protected interface identity changed during lookup");
            }
            Ok(adapter)
        }

        fn session(&mut self) -> Result<String> {
            require_admin()?;
            let token = nanoid::nanoid!();
            let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
            // HKLM volatile keys survive logoff, but not a full Windows hive unload/reboot.
            let (key, disposition) = machine
                .create_subkey_with_options_flags(
                    format!("{SESSION_KEY}{token}"),
                    REG_OPTION_VOLATILE,
                    KEY_READ | KEY_WRITE | KEY_WOW64_64KEY,
                )
                .context("create temporary TUN guard Windows session key")?;
            // REG_OPTION_VOLATILE is ignored for existing keys, so never adopt one.
            if disposition != winreg::enums::RegDisposition::REG_CREATED_NEW_KEY {
                bail!("The temporary TUN guard session key already exists; no network settings were changed");
            }
            key.set_value("Token", &token)
                .context("record temporary TUN guard Windows session token")?;
            Ok(token)
        }

        fn same_session(&mut self, session: &str) -> Result<bool> {
            let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
            match machine.open_subkey_with_flags(format!("{SESSION_KEY}{session}"), KEY_READ | KEY_WOW64_64KEY) {
                Ok(key) => Ok(key
                    .get_value::<String, _>("Token")
                    .context("read TUN guard Windows session token")?
                    == session),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
                Err(error) => Err(error).context("read TUN guard Windows session key"),
            }
        }

        fn can_change(&mut self) -> Result<()> {
            require_admin()
        }

        fn change(&mut self, target: &Target, expected: bool, value: bool) -> Result<bool> {
            let luid = target_luid(target)?
                .context("Protected interface is unavailable; forwarding restoration remains pending")?;
            let adapter = inspect_luid(luid)?;
            if adapter.target.guid != target.guid || !adapter.hardware || !adapter.ethernet_or_wifi {
                bail!("The protected interface no longer identifies the original physical uplink");
            }
            if !value {
                adapter.validate()?;
            }
            let mut row = ip_row(luid)?;
            if row.ForwardingEnabled != expected {
                return Ok(false);
            }
            require_admin()?;
            row.ForwardingEnabled = value;
            // Required by SetIpInterfaceEntry for IPv4, even when querying an existing row.
            row.SitePrefixLength = 0;
            // SAFETY: only ForwardingEnabled is changed in the freshly queried IPv4 row.
            check_code(
                unsafe { SetIpInterfaceEntry(&mut row) },
                "temporarily set IPv4 forwarding",
            )?;
            if ip_row(luid)?.ForwardingEnabled != value {
                bail!(
                    "IPv4 forwarding on {} did not remain in the requested state",
                    target.name
                );
            }
            Ok(true)
        }

        fn save(&mut self, records: &[Record]) -> Result<()> {
            if records.is_empty() {
                match fs::remove_file(&self.path) {
                    Ok(()) => return Ok(()),
                    Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
                    Err(error) => return Err(error).context("remove restored TUN guard journal"),
                }
            }
            atomic_write(
                &self.path,
                &Journal {
                    version: 1,
                    records: records.to_vec(),
                },
            )
            .context("save TUN guard journal before changing network settings")
        }

        fn archive(&mut self, records: &[Record]) -> Result<()> {
            let archive = self
                .path
                .with_file_name(format!("tun-compatibility-unrestored-{}.json", nanoid::nanoid!()));
            atomic_write(
                &archive,
                &Journal {
                    version: 1,
                    records: records.to_vec(),
                },
            )?;
            logging!(
                warn,
                Type::Core,
                "TUN guard session changed; no network settings were restored. Original settings retained at {}",
                archive.display()
            );
            Ok(())
        }
    }

    struct Runtime {
        state: State,
        backend: NativeBackend,
        loaded: bool,
        recovered: bool,
        recovery_pending: bool,
        lock: Option<OwnedHandle>,
        file_lock: Option<File>,
    }

    impl Runtime {
        fn claim(&mut self) -> Result<()> {
            if self.lock.is_some() {
                return Ok(());
            }
            let name = wide(std::ffi::OsStr::new(r"Global\ClashVergeRevTunCompatibilityGuard"));
            // SAFETY: event is private to this feature and the name is NUL-terminated.
            let handle = unsafe { CreateEventW(std::ptr::null(), 1, 0, name.as_ptr()) };
            // SAFETY: capture the native call's last-error state before another call can change it.
            let last_error = unsafe { GetLastError() };
            if handle.is_null() {
                return Err(std::io::Error::from_raw_os_error(last_error as i32))
                    .context("another instance or account may own TUN compatibility protection");
            }
            // SAFETY: CreateEventW returned an owned handle, which closes on every error path.
            let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
            if last_error == ERROR_ALREADY_EXISTS {
                bail!("Another Clash Verge instance already owns TUN compatibility protection");
            }
            let parent = self.backend.path.parent().context("TUN guard journal has no parent")?;
            fs::create_dir_all(parent)?;
            self.file_lock = Some(
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .create(true)
                    .truncate(false)
                    .share_mode(0)
                    .open(parent.join(".tun-compatibility-guard.lock"))
                    .context("TUN compatibility protection is owned by another instance")?,
            );
            self.lock = Some(handle);
            Ok(())
        }

        fn release_if_idle(&mut self) {
            if self.state.idle() {
                self.file_lock = None;
                self.lock = None;
            }
        }

        fn load(&mut self) -> Result<()> {
            if self.loaded {
                return Ok(());
            }
            self.backend.path = crate::utils::dirs::app_home_dir()?.join(JOURNAL_FILE);
            let bytes = match fs::read(&self.backend.path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == ErrorKind::NotFound => {
                    self.loaded = true;
                    self.recovered = true;
                    self.recovery_pending = false;
                    return Ok(());
                }
                Err(error) => return Err(error).context("read TUN guard restoration journal"),
            };
            self.recovery_pending = true;
            self.claim()?;
            let journal: Journal = serde_json::from_slice(&bytes)
                .context("TUN guard journal is invalid; original network settings were not changed")?;
            if journal.version != 1
                || journal.records.iter().any(|record| {
                    !record.original_forwarding
                        || record.target.guid == [0; 16]
                        || record.session.len() != 21
                        || !record
                            .session
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
                })
            {
                bail!("TUN guard journal is unsupported; original network settings were not changed");
            }
            self.state.records = journal.records;
            self.loaded = true;
            Ok(())
        }
    }

    static RUNTIME: LazyLock<Mutex<Runtime>> = LazyLock::new(|| {
        Mutex::new(Runtime {
            state: State::default(),
            backend: NativeBackend { path: PathBuf::new() },
            loaded: false,
            recovered: false,
            recovery_pending: false,
            lock: None,
            file_lock: None,
        })
    });

    pub(super) fn prepare(name: Option<&str>) -> Result<Option<u64>> {
        let mut runtime = RUNTIME.lock();
        if let Err(error) = runtime.load() {
            if name.is_none() && runtime.state.idle() {
                runtime.release_if_idle();
                return Ok(None);
            }
            return Err(error);
        }
        if !runtime.recovered {
            if name.is_none() {
                return Ok(None);
            }
            bail!(
                "TUN forwarding restoration is pending; stop any other core before recovering the previous protection session"
            );
        }
        if name.is_none() && runtime.state.idle() {
            return Ok(None);
        }
        let refresh = runtime.state.idle() && runtime.lock.is_none();
        runtime.claim()?;
        if refresh {
            // Another instance may have left a journal since this idle runtime last checked.
            runtime.loaded = false;
            runtime.recovered = false;
            runtime.load()?;
            if !runtime.recovered {
                bail!("Another protection session requires safe forwarding recovery before TUN can start");
            }
        }
        let Runtime { state, backend, .. } = &mut *runtime;
        let result = state.prepare(backend, name).map(Some);
        runtime.release_if_idle();
        result
    }

    pub(super) fn preflight(name: Option<&str>) -> Result<()> {
        if name.is_none() {
            return Ok(());
        }
        let mut runtime = RUNTIME.lock();
        if runtime.recovery_pending || (runtime.loaded && !runtime.recovered) {
            bail!(
                "TUN forwarding restoration is pending; stop any other core before recovering the previous protection session"
            );
        }
        if runtime.state.idle()
            && runtime.lock.is_none()
            && crate::utils::dirs::app_home_dir()?.join(JOURNAL_FILE).try_exists()?
        {
            bail!("A previous protection session requires safe forwarding recovery before TUN can start");
        }
        let Runtime { state, backend, .. } = &mut *runtime;
        let result = state.preflight(backend, name);
        drop(runtime);
        result
    }

    pub(super) fn finish(id: u64, commit: bool) -> Result<()> {
        let mut runtime = RUNTIME.lock();
        let Runtime { state, backend, .. } = &mut *runtime;
        let result = if commit {
            state.commit(backend, id)
        } else {
            state.rollback(backend, id)
        };
        runtime.release_if_idle();
        result
    }

    pub(super) fn retain(id: u64) -> Result<()> {
        RUNTIME.lock().state.retain(id)
    }

    pub(super) fn restore() -> Result<()> {
        let mut runtime = RUNTIME.lock();
        runtime.load()?;
        if !runtime.recovered {
            bail!("TUN forwarding recovery requires confirming that no previous core is running");
        }
        let Runtime { state, backend, .. } = &mut *runtime;
        let result = state.restore(backend);
        runtime.release_if_idle();
        result
    }

    pub(super) fn recover() -> Result<()> {
        let mut runtime = RUNTIME.lock();
        runtime.load()?;
        if runtime.recovered {
            return Ok(());
        }
        let Runtime { state, backend, .. } = &mut *runtime;
        state.recover(backend)?;
        runtime.recovered = true;
        runtime.recovery_pending = false;
        runtime.release_if_idle();
        drop(runtime);
        Ok(())
    }

    pub(super) fn needs_recovery() -> Result<bool> {
        let mut runtime = RUNTIME.lock();
        if runtime.recovered {
            return Ok(false);
        }
        if runtime.loaded {
            return Ok(true);
        }
        let pending = crate::utils::dirs::app_home_dir()?
            .join(JOURNAL_FILE)
            .try_exists()
            .context("query TUN guard restoration journal")?;
        runtime.recovery_pending = pending;
        drop(runtime);
        Ok(pending)
    }

    pub(super) fn check() -> Result<()> {
        let mut runtime = RUNTIME.lock();
        if runtime.recovery_pending {
            bail!(
                "TUN forwarding restoration remains pending; stop any other core and restart Clash Verge as administrator to recover the saved settings"
            );
        }
        let Runtime { state, backend, .. } = &mut *runtime;
        let result = state.check(backend);
        drop(runtime);
        result
    }

    pub(super) fn has_owned_guard() -> bool {
        let runtime = RUNTIME.lock();
        runtime.recovered && !runtime.state.idle()
    }
}

pub struct GuardTransaction {
    #[cfg(windows)]
    id: Option<u64>,
}

/// Validate protection before stopping a service core; do not claim or change network settings.
pub fn preflight(interface_name: Option<&str>) -> Result<()> {
    #[cfg(windows)]
    {
        native::preflight(interface_name)
    }
    #[cfg(not(windows))]
    {
        let _ = interface_name;
        Ok(())
    }
}

/// Some protects only the exact pinned uplink; None releases the previous guard on commit.
pub fn prepare(interface_name: Option<&str>) -> Result<GuardTransaction> {
    #[cfg(windows)]
    {
        Ok(GuardTransaction {
            id: native::prepare(interface_name)?,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = interface_name;
        Ok(GuardTransaction {})
    }
}

impl GuardTransaction {
    pub fn commit(self) -> Result<()> {
        #[cfg(windows)]
        {
            let mut transaction = self;
            if let Some(id) = transaction.id.take() {
                let result = native::finish(id, true);
                if result.is_ok() {
                    clear_restore_notice();
                }
                return result;
            }
        }
        Ok(())
    }

    /// Keep protection until a later confirmed stop when the Core's failed start is indeterminate.
    pub fn retain(self) -> Result<()> {
        #[cfg(windows)]
        {
            let mut transaction = self;
            if let Some(id) = transaction.id.take() {
                return native::retain(id);
            }
        }
        Ok(())
    }
}

impl Drop for GuardTransaction {
    fn drop(&mut self) {
        #[cfg(windows)]
        if let Some(id) = self.id.take()
            && let Err(error) = native::finish(id, false)
        {
            clash_verge_logging::logging!(
                error,
                clash_verge_logging::Type::Core,
                "TUN compatibility rollback remains pending: {error:#}"
            );
            let detail = format!("{error:#}");
            record_restore_notice(detail.clone());
            super::handle::Handle::notice(super::notify::NoticeStatus::TunCompatibilityGuardRestoreFailed, detail);
        }
    }
}

pub fn recover() -> Result<()> {
    #[cfg(windows)]
    {
        let result = native::recover();
        if result.is_ok() {
            clear_restore_notice();
        }
        result
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Only probes the journal; the lifecycle must exclude other cores before calling recover.
pub fn needs_recovery() -> Result<bool> {
    #[cfg(windows)]
    {
        native::needs_recovery()
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// Reports only in-process ownership, never ownership from an unrecovered journal.
pub fn has_owned_guard() -> bool {
    #[cfg(windows)]
    {
        native::has_owned_guard()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn restore() -> Result<()> {
    #[cfg(windows)]
    {
        let result = native::restore();
        if result.is_ok() {
            clear_restore_notice();
        }
        result
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Audit the committed target without applying settings or selecting another interface.
pub fn check() -> Result<()> {
    #[cfg(windows)]
    {
        native::check()
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::state::{Adapter, Backend, Record, State, Target};
    use super::{InterfaceUnavailableReason, interface_unavailable};
    use anyhow::{Result, bail};
    use std::collections::HashMap;

    #[derive(Default)]
    struct Fake {
        forwarding: HashMap<[u8; 16], bool>,
        session: Option<String>,
        journal: Vec<Record>,
        archived: Vec<Record>,
        writes: usize,
        fail_save: bool,
        fail_change: bool,
        physical: bool,
    }

    fn target(name: &str) -> Target {
        Target {
            name: name.to_owned(),
            guid: [if name == "A" { 1 } else { 2 }; 16],
        }
    }

    impl Backend for Fake {
        fn adapter(&mut self, name: &str) -> Result<Adapter> {
            self.inspect(&target(name))?.ok_or_else(|| anyhow::anyhow!("missing"))
        }
        fn inspect(&mut self, target: &Target) -> Result<Option<Adapter>> {
            Ok(self.forwarding.get(&target.guid).map(|forwarding| Adapter {
                target: target.clone(),
                forwarding: *forwarding,
                hardware: self.physical,
                ethernet_or_wifi: true,
                up: true,
                uplink: true,
            }))
        }
        fn session(&mut self) -> Result<String> {
            Ok(self.session.get_or_insert_with(|| "same-boot".to_owned()).clone())
        }
        fn same_session(&mut self, session: &str) -> Result<bool> {
            Ok(self.session.as_deref() == Some(session))
        }
        fn can_change(&mut self) -> Result<()> {
            if self.fail_change {
                bail!("permission denied");
            }
            Ok(())
        }
        fn change(&mut self, target: &Target, expected: bool, value: bool) -> Result<bool> {
            if self.fail_change {
                bail!("permission denied");
            }
            let current = self
                .forwarding
                .get_mut(&target.guid)
                .ok_or_else(|| anyhow::anyhow!("unknown fake interface"))?;
            if *current != expected {
                return Ok(false);
            }
            if !value {
                assert!(self.journal.iter().any(|record| record.target.guid == target.guid));
            }
            *current = value;
            self.writes += 1;
            Ok(true)
        }
        fn save(&mut self, records: &[Record]) -> Result<()> {
            if self.fail_save {
                bail!("disk full");
            }
            self.journal = records.to_vec();
            Ok(())
        }
        fn archive(&mut self, records: &[Record]) -> Result<()> {
            self.archived.extend_from_slice(records);
            Ok(())
        }
    }

    fn setup() -> (State, Fake) {
        (
            State::default(),
            Fake {
                forwarding: [(target("A").guid, true), (target("B").guid, true)].into(),
                physical: true,
                ..Default::default()
            },
        )
    }

    #[test]
    fn disconnected_uplink_remains_typed_through_error_context() -> Result<()> {
        for (up, uplink) in [(false, true), (true, false), (false, false)] {
            let adapter = Adapter {
                target: target("WLAN"),
                forwarding: false,
                hardware: true,
                ethernet_or_wifi: true,
                up,
                uplink,
            };
            let error = adapter
                .validate()
                .err()
                .ok_or_else(|| anyhow::anyhow!("disconnected uplink was accepted"))?
                .context("core startup");
            let unavailable = interface_unavailable(&error)
                .ok_or_else(|| anyhow::anyhow!("selected uplink error lost its interface type"))?;
            assert_eq!(unavailable.name, "WLAN");
            assert_eq!(unavailable.reason, InterfaceUnavailableReason::Disconnected);
        }
        Ok(())
    }

    #[test]
    fn preflight_checks_target_and_permissions_without_mutating_or_claiming() -> Result<()> {
        let (state, mut backend) = setup();
        state.preflight(&mut backend, Some("A"))?;
        assert_eq!(backend.writes, 0);
        assert!(backend.journal.is_empty());
        assert!(backend.session.is_none());
        assert!(state.idle());
        backend.fail_change = true;
        assert!(state.preflight(&mut backend, Some("A")).is_err());
        backend.forwarding.insert(target("A").guid, false);
        state.preflight(&mut backend, Some("A"))?;
        backend.forwarding.remove(&target("A").guid);
        assert!(state.preflight(&mut backend, Some("A")).is_err());
        state.preflight(&mut backend, None)?;
        assert_eq!(backend.writes, 0);
        assert!(backend.journal.is_empty());
        assert!(backend.session.is_none());
        Ok(())
    }

    #[test]
    fn guard_rolls_back_new_changes_and_keeps_the_previous_target_until_commit() -> Result<()> {
        let (mut state, mut backend) = setup();
        let first = state.prepare(&mut backend, Some("A"))?;
        state.commit(&mut backend, first)?;
        let next = state.prepare(&mut backend, Some("B"))?;
        assert!(!backend.forwarding[&target("A").guid]);
        assert!(!backend.forwarding[&target("B").guid]);
        state.rollback(&mut backend, next)?;
        assert!(!backend.forwarding[&target("A").guid]);
        assert!(backend.forwarding[&target("B").guid]);
        let next = state.prepare(&mut backend, Some("B"))?;
        state.commit(&mut backend, next)?;
        assert!(backend.forwarding[&target("A").guid]);
        assert!(!backend.forwarding[&target("B").guid]);
        let off = state.prepare(&mut backend, None)?;
        state.rollback(&mut backend, off)?;
        assert!(!backend.forwarding[&target("B").guid]);
        let off = state.prepare(&mut backend, None)?;
        state.commit(&mut backend, off)?;
        assert!(backend.forwarding[&target("B").guid]);
        assert!(state.idle());
        Ok(())
    }

    #[test]
    fn disk_or_permission_failure_cannot_lose_the_original_setting() {
        let (mut state, mut backend) = setup();
        backend.fail_save = true;
        assert!(state.prepare(&mut backend, Some("A")).is_err());
        assert_eq!(backend.writes, 0);
        assert!(state.records.is_empty());
        backend.fail_save = false;
        backend.fail_change = true;
        assert!(state.prepare(&mut backend, Some("A")).is_err());
        assert_eq!(backend.writes, 0);
        assert!(backend.forwarding[&target("A").guid]);
    }

    #[test]
    fn recovery_preserves_external_changes_and_does_not_restore_after_a_new_boot() -> Result<()> {
        let (mut state, mut backend) = setup();
        let first = state.prepare(&mut backend, Some("A"))?;
        state.commit(&mut backend, first)?;
        backend.forwarding.insert(target("A").guid, true);
        let writes = backend.writes;
        state.recover(&mut backend)?;
        assert_eq!(backend.writes, writes);
        let next = state.prepare(&mut backend, Some("A"))?;
        state.commit(&mut backend, next)?;
        backend.session = None;
        let writes = backend.writes;
        state.recover(&mut backend)?;
        assert_eq!(backend.writes, writes);
        assert!(!backend.forwarding[&target("A").guid]);
        assert_eq!(backend.archived.len(), 1);
        assert!(state.records.is_empty());
        Ok(())
    }

    #[test]
    fn already_disabled_is_still_audited_and_virtual_interfaces_are_rejected() -> Result<()> {
        let (mut state, mut backend) = setup();
        backend.physical = false;
        let error = state
            .prepare(&mut backend, Some("A"))
            .err()
            .ok_or_else(|| anyhow::anyhow!("virtual interface was accepted"))?;
        assert!(interface_unavailable(&error).is_none());
        assert_eq!(backend.writes, 0);
        backend.physical = true;
        backend.forwarding.insert(target("A").guid, false);
        let first = state.prepare(&mut backend, Some("A"))?;
        state.commit(&mut backend, first)?;
        assert!(state.records.is_empty());
        state.check(&mut backend)?;
        backend.forwarding.insert(target("A").guid, true);
        assert!(state.check(&mut backend).is_err());
        assert_eq!(backend.writes, 0);
        Ok(())
    }

    #[test]
    fn failed_commit_cleanup_keeps_the_new_target_and_missing_original_journal() -> Result<()> {
        let (mut state, mut backend) = setup();
        let first = state.prepare(&mut backend, Some("A"))?;
        state.commit(&mut backend, first)?;
        let next = state.prepare(&mut backend, Some("B"))?;
        backend.forwarding.remove(&target("A").guid);
        assert!(state.commit(&mut backend, next).is_err());
        assert_eq!(state.active, Some(target("B")));
        assert!(!backend.forwarding[&target("B").guid]);
        assert_eq!(backend.journal.len(), 2);
        assert!(state.rollback(&mut backend, next).is_err());
        state.check(&mut backend)?;
        let off = state.prepare(&mut backend, None)?;
        assert!(state.commit(&mut backend, off).is_err());
        assert!(state.active.is_none());
        assert!(backend.forwarding[&target("B").guid]);
        assert_eq!(backend.journal.len(), 1);
        backend.forwarding.insert(target("A").guid, false);
        state.restore(&mut backend)?;
        assert!(backend.forwarding[&target("A").guid]);
        assert!(backend.forwarding[&target("B").guid]);
        assert!(backend.journal.is_empty());
        Ok(())
    }

    #[test]
    fn indeterminate_core_start_retains_both_targets_without_restoration() -> Result<()> {
        let (mut state, mut backend) = setup();
        let first = state.prepare(&mut backend, Some("A"))?;
        state.commit(&mut backend, first)?;
        let next = state.prepare(&mut backend, Some("B"))?;
        let writes = backend.writes;
        state.retain(next)?;
        assert_eq!(backend.writes, writes);
        assert_eq!(state.active, Some(target("B")));
        assert!(!backend.forwarding[&target("A").guid]);
        assert!(!backend.forwarding[&target("B").guid]);
        assert_eq!(backend.journal.len(), 2);
        state.restore(&mut backend)?;
        assert!(state.idle());
        Ok(())
    }
}
