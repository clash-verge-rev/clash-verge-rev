use crate::utils::dirs;
use anyhow::{Context as _, Result};
use clash_verge_service_ipc::{OwnerCredentials, OwnerIdentity};
use std::path::Path;

pub(crate) fn current_owner_credentials() -> Result<OwnerCredentials> {
    current_owner_credentials_for_root(&dirs::app_home_dir()?)
}

#[allow(clippy::unnecessary_wraps)] // Windows SID discovery is fallible; Unix keeps the shared API.
pub(crate) fn current_owner_identity() -> Result<OwnerIdentity> {
    #[cfg(unix)]
    return Ok(OwnerIdentity::Unix {
        uid: unsafe { libc::geteuid() },
        gid: unsafe { libc::getegid() },
    });

    #[cfg(windows)]
    {
        windows_current_identity()
    }
}

pub(crate) fn current_owner_credentials_for_root(app_root: &Path) -> Result<OwnerCredentials> {
    let app_data_root = std::fs::canonicalize(app_root)
        .with_context(|| format!("failed to canonicalize application data root {app_root:?}"))?;

    #[cfg(unix)]
    let (identity, token) = (current_owner_identity()?, None);

    #[cfg(windows)]
    let (identity, token) = windows_owner_credentials(&app_data_root)?;

    Ok(OwnerCredentials {
        identity,
        app_data_dir: app_data_root.to_string_lossy().into_owned(),
        token,
    })
}

#[cfg(windows)]
fn windows_owner_credentials(app_data_root: &Path) -> Result<(OwnerIdentity, Option<String>)> {
    let sid = windows_owner::current_sid()?;
    let token = windows_owner::load_or_create_token(app_data_root, &sid)?;
    Ok((OwnerIdentity::Windows { sid }, Some(token)))
}

#[cfg(windows)]
fn windows_current_identity() -> Result<OwnerIdentity> {
    Ok(OwnerIdentity::Windows {
        sid: windows_owner::current_sid()?,
    })
}

#[cfg(windows)]
pub(crate) fn create_private_current_user_file(path: &Path) -> Result<std::fs::File> {
    windows_owner::create_private_file(path)
}

#[cfg(windows)]
pub(crate) fn open_private_current_user_file(path: &Path) -> Result<std::fs::File> {
    windows_owner::open_private_file(path)
}

#[cfg(windows)]
pub(crate) fn open_or_create_private_current_user_file(path: &Path) -> Result<std::fs::File> {
    windows_owner::open_or_create_private_file(path)
}

/// Repairs an application data root Windows no longer reports as owned by the current user.
///
/// The Service authenticates by comparing this directory's owner SID against the caller's, so a
/// root left behind by another account locks Service mode out for good.
#[cfg(windows)]
pub(crate) fn repair_app_data_root_owner(app_data_root: &Path) -> Result<()> {
    windows_owner::repair_root_owner(app_data_root)
}

#[cfg(windows)]
pub(crate) fn current_user_pipe_sddl() -> Result<String> {
    let sid = windows_owner::current_sid()?;
    Ok(format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)(A;;GA;;;BA)"))
}

#[cfg(windows)]
mod windows_owner {
    use anyhow::{Context as _, Result, bail};
    use clash_verge_logging::{Type, logging};
    use clash_verge_service_ipc::OWNER_TOKEN_FILE_NAME;
    use std::ffi::c_void;
    use std::io::{Read as _, Write as _};
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _};
    use std::path::Path;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_FILE_EXISTS, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, GENERIC_READ,
        GENERIC_WRITE, GetLastError, INVALID_HANDLE_VALUE, LocalFree,
    };
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
        SE_FILE_OBJECT, SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION, EqualSid, GetAce, GetSecurityDescriptorControl,
        GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, GetTokenInformation, IsValidSid, IsWellKnownSid,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SE_DACL_PROTECTED,
        SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser, WinBuiltinAdministratorsSid, WinLocalSystemSid,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, CREATE_NEW, CreateFileW, FILE_ALL_ACCESS, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_DISK,
        GetFileInformationByHandle, GetFileType, OPEN_EXISTING, READ_CONTROL, WRITE_DAC, WRITE_OWNER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    const TOKEN_BYTES: usize = 32;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    /// Reserved files that carry their own owner check and are recreated on demand.
    const REGENERATED_FILES: [&str; 3] = [
        OWNER_TOKEN_FILE_NAME,
        crate::utils::server::INSTANCE_RECORD_FILE,
        crate::utils::server::INSTANCE_LOCK_FILE,
    ];

    pub(super) fn current_sid() -> Result<String> {
        let mut token = std::ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err(std::io::Error::last_os_error()).context("failed to open process token");
        }
        let token = OwnedHandle(token);

        let mut required = 0_u32;
        unsafe { GetTokenInformation(token.0, TokenUser, std::ptr::null_mut(), 0, &mut required) };
        if required == 0 {
            return Err(std::io::Error::last_os_error()).context("failed to size process SID buffer");
        }
        let words = (required as usize).div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0_usize; words];
        if unsafe { GetTokenInformation(token.0, TokenUser, buffer.as_mut_ptr().cast(), required, &mut required) } == 0
        {
            return Err(std::io::Error::last_os_error()).context("failed to read process SID");
        }
        let token_user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        sid_to_string(token_user.User.Sid)
    }

    pub(super) fn load_or_create_token(app_data_root: &Path, sid: &str) -> Result<String> {
        let token_path = app_data_root.join(OWNER_TOKEN_FILE_NAME);
        let descriptor = LocalSecurityDescriptor::from_sid(sid)?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        let wide = wide_path(&token_path)?;
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                &attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_HIDDEN | FILE_FLAG_OPEN_REPARSE_POINT,
                std::ptr::null_mut(),
            )
        };

        if handle != INVALID_HANDLE_VALUE {
            let mut file = unsafe { std::fs::File::from_raw_handle(handle) };
            let mut token = [0_u8; TOKEN_BYTES];
            getrandom::fill(&mut token).context("failed to generate owner token")?;
            file.write_all(&token).context("failed to write owner token")?;
            file.sync_all().context("failed to flush owner token")?;
            return Ok(encode_token(&token));
        }
        if unsafe { GetLastError() } != ERROR_FILE_EXISTS {
            return Err(std::io::Error::last_os_error()).context("failed to create owner token");
        }

        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | READ_CONTROL | WRITE_DAC,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error()).context("failed to open owner token");
        }
        let mut file = unsafe { std::fs::File::from_raw_handle(handle) };
        validate_token_file(&file, descriptor.owner()?)?;
        descriptor.apply_dacl(file.as_raw_handle())?;

        let mut token = [0_u8; TOKEN_BYTES];
        file.read_exact(&mut token).context("failed to read owner token")?;
        Ok(encode_token(&token))
    }

    pub(super) fn create_private_file(path: &Path) -> Result<std::fs::File> {
        let sid = current_sid()?;
        let descriptor = LocalSecurityDescriptor::from_sid(&sid)?;
        create_file(path, &descriptor)
    }

    pub(super) fn open_private_file(path: &Path) -> Result<std::fs::File> {
        let sid = current_sid()?;
        let descriptor = LocalSecurityDescriptor::from_sid(&sid)?;
        let file = open_file(path)?;
        validate_private_file(&file, descriptor.owner()?)?;
        Ok(file)
    }

    pub(super) fn open_or_create_private_file(path: &Path) -> Result<std::fs::File> {
        let sid = current_sid()?;
        let descriptor = LocalSecurityDescriptor::from_sid(&sid)?;
        match create_file(path, &descriptor) {
            Ok(file) => Ok(file),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.raw_os_error() == Some(ERROR_FILE_EXISTS as i32)) =>
            {
                let file = open_file(path)?;
                validate_private_file(&file, descriptor.owner()?)?;
                Ok(file)
            }
            Err(error) => Err(error),
        }
    }

    fn create_file(path: &Path, descriptor: &LocalSecurityDescriptor) -> Result<std::fs::File> {
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        let wide = wide_path(path)?;
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                &attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error()).context("failed to create private current-user file");
        }
        let file = unsafe { std::fs::File::from_raw_handle(handle) };
        validate_private_file(&file, descriptor.owner()?)?;
        Ok(file)
    }

    fn open_file(path: &Path) -> Result<std::fs::File> {
        let wide = wide_path(path)?;
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error()).context("failed to open private current-user file");
        }
        Ok(unsafe { std::fs::File::from_raw_handle(handle) })
    }

    fn validate_private_file(file: &std::fs::File, expected_owner: PSID) -> Result<()> {
        let handle = file.as_raw_handle();
        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(handle, &mut information) } == 0 {
            return Err(std::io::Error::last_os_error()).context("failed to inspect private file metadata");
        }
        if information.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
            || unsafe { GetFileType(handle) } != FILE_TYPE_DISK
        {
            bail!("current-user file is not an ordinary file");
        }

        let mut owner = std::ptr::null_mut();
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut security = std::ptr::null_mut();
        let status = unsafe {
            GetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut security,
            )
        };
        if status != 0 || security.is_null() {
            bail!("failed to inspect private file security: Windows error {status}");
        }
        let security = LocalSecurityDescriptor(security);
        if owner.is_null() || unsafe { EqualSid(owner, expected_owner) } == 0 || dacl.is_null() {
            bail!("current-user file owner or DACL is invalid");
        }
        let mut control = 0_u16;
        let mut revision = 0_u32;
        if unsafe { GetSecurityDescriptorControl(security.0, &mut control, &mut revision) } == 0
            || control & SE_DACL_PROTECTED == 0
        {
            bail!("current-user file DACL is not protected");
        }

        let mut owner_ace = false;
        let mut system_ace = false;
        let mut administrators_ace = false;
        for index in 0..unsafe { (*dacl).AceCount } as u32 {
            let mut ace = std::ptr::null_mut();
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 || ace.is_null() {
                bail!("current-user file DACL could not be inspected");
            }
            let allowed = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
            if allowed.Header.AceType != ACCESS_ALLOWED_ACE_TYPE || allowed.Mask & FILE_ALL_ACCESS != FILE_ALL_ACCESS {
                bail!("current-user file DACL contains an unexpected ACE");
            }
            let ace_sid = std::ptr::addr_of!(allowed.SidStart).cast_mut().cast::<c_void>();
            if unsafe { IsValidSid(ace_sid) } == 0 {
                bail!("current-user file DACL contains an invalid SID");
            }
            if unsafe { EqualSid(ace_sid, expected_owner) } != 0 {
                owner_ace = true;
            } else if unsafe { IsWellKnownSid(ace_sid, WinLocalSystemSid) } != 0 {
                system_ace = true;
            } else if unsafe { IsWellKnownSid(ace_sid, WinBuiltinAdministratorsSid) } != 0 {
                administrators_ace = true;
            } else {
                bail!("current-user file DACL grants access to another SID");
            }
        }
        if unsafe { (*dacl).AceCount } != 3 || !owner_ace || !system_ace || !administrators_ace {
            bail!("current-user file DACL is missing a required principal");
        }
        Ok(())
    }

    fn validate_token_file(file: &std::fs::File, expected_owner: PSID) -> Result<()> {
        let handle = file.as_raw_handle();
        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(handle, &mut information) } == 0 {
            return Err(std::io::Error::last_os_error()).context("failed to inspect owner token metadata");
        }
        if information.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
            || unsafe { GetFileType(handle) } != FILE_TYPE_DISK
            || information.nFileSizeHigh != 0
            || information.nFileSizeLow != TOKEN_BYTES as u32
        {
            bail!("owner token is not an ordinary 32-byte file");
        }

        let mut owner = std::ptr::null_mut();
        let mut security = std::ptr::null_mut();
        let status = unsafe {
            GetSecurityInfo(
                handle,
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                &mut owner,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut security,
            )
        };
        if status != 0 || security.is_null() {
            bail!("failed to inspect owner token security: Windows error {status}");
        }
        let security = LocalSecurityDescriptor(security);
        if owner.is_null() || unsafe { EqualSid(owner, expected_owner) } == 0 {
            bail!("owner token belongs to a different Windows user");
        }
        drop(security);
        Ok(())
    }

    pub(super) fn repair_root_owner(root: &Path) -> Result<()> {
        // The Service canonicalizes before checking, so resolve junctions to the same object.
        let root = match std::fs::canonicalize(root) {
            Ok(path) => path,
            // Nothing to repair: this process creates the root and owns it by construction.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error).context("failed to canonicalize the application data root"),
        };
        let root = root.as_path();

        let sid = current_sid()?;
        let descriptor = LocalSecurityDescriptor::from_sid(&sid)?;
        let expected = descriptor.owner()?;

        let directory = open_no_reparse(root, true, READ_CONTROL)?;
        let owned = owner_matches(&directory, expected)?;
        drop(directory);

        if !owned {
            logging!(
                warn,
                Type::Setup,
                "应用数据目录 {root:?} 的所有者不是当前用户，尝试接管"
            );
            match take_directory_ownership(root, expected) {
                Ok(()) => logging!(info, Type::Setup, "已接管应用数据目录所有权"),
                // Only a refused takeover is worth moving the user's data over.
                Err(error) if is_access_denied(&error) => {
                    logging!(warn, Type::Setup, "接管所有权被拒绝，改为重建目录: {error:#}");
                    rebuild_root(root, expected)?;
                }
                Err(error) => return Err(error),
            }
        }

        // The Service and the singleton check compare these files' owner too.
        drop_files_owned_by_others(root, expected)
    }

    /// Drops the reserved files an earlier account left behind, so they are recreated for this one.
    fn drop_files_owned_by_others(root: &Path, expected: PSID) -> Result<()> {
        for name in REGENERATED_FILES {
            let path = root.join(name);
            let ours = match open_no_reparse(&path, false, READ_CONTROL) {
                Ok(file) => {
                    let owned = owner_matches(&file, expected)?;
                    drop(file);
                    owned
                }
                Err(error)
                    if is_os_error(&error, ERROR_FILE_NOT_FOUND) || is_os_error(&error, ERROR_PATH_NOT_FOUND) =>
                {
                    continue;
                }
                // A DACL that refuses even the owner read settles it just as well.
                Err(_) => false,
            };
            if !ours {
                std::fs::remove_file(&path).with_context(|| format!("failed to drop the stale {name}"))?;
                logging!(info, Type::Setup, "已丢弃属于其它账户的 {name}");
            }
        }
        Ok(())
    }

    fn is_access_denied(error: &anyhow::Error) -> bool {
        is_os_error(error, ERROR_ACCESS_DENIED)
    }

    fn is_os_error(error: &anyhow::Error, code: u32) -> bool {
        error
            .downcast_ref::<std::io::Error>()
            .and_then(std::io::Error::raw_os_error)
            == Some(code as i32)
    }

    /// Rebuilds the root as a directory the current user owns, carrying the contents over.
    ///
    /// Nothing checks the children's owner, so they move as they are. Any failure puts the data
    /// back: a half-moved root would read as a fresh install and be filled with defaults.
    fn rebuild_root(root: &Path, expected: PSID) -> Result<()> {
        let parent = root.parent().context("application data root has no parent")?;
        let mut stale = root
            .file_name()
            .context("application data root has no name")?
            .to_os_string();
        stale.push(format!(".stale-{}", std::process::id()));
        let stale = parent.join(stale);

        std::fs::rename(root, &stale).context("failed to set the application data root aside")?;
        if let Err(error) = std::fs::create_dir(root) {
            // Something else took the name; it is not ours to walk into, so restore blind.
            let _ = std::fs::rename(&stale, root);
            return Err(error).context("failed to recreate the application data root");
        }
        if let Err(error) = repopulate_root(root, &stale, expected) {
            // The root is the directory just created, so draining it follows no one else's link.
            restore_root(root, &stale)?;
            return Err(error);
        }

        // Only the reserved files remain behind.
        if let Err(error) = std::fs::remove_dir_all(&stale) {
            logging!(warn, Type::Setup, "旧数据目录 {stale:?} 未能清理: {error}");
        }
        logging!(info, Type::Setup, "已重建应用数据目录");
        Ok(())
    }

    /// Fills the freshly created root from the one set aside, leaving the reserved files behind.
    fn repopulate_root(root: &Path, stale: &Path, expected: PSID) -> Result<()> {
        // An elevated process creates directories owned by Administrators — the state being repaired.
        let directory = open_no_reparse(root, true, READ_CONTROL)?;
        let owned = owner_matches(&directory, expected)?;
        drop(directory);
        if !owned {
            take_directory_ownership(root, expected)?;
        }

        for entry in std::fs::read_dir(stale).context("failed to read the stale application data root")? {
            let name = entry
                .context("failed to read a stale application data root entry")?
                .file_name();
            if REGENERATED_FILES.iter().any(|regenerated| name == *regenerated) {
                continue;
            }
            std::fs::rename(stale.join(&name), root.join(&name))
                .with_context(|| format!("failed to move {name:?} into the recreated root"))?;
        }
        Ok(())
    }

    /// Drains a failed rebuild back into the set-aside root and restores it under the real name.
    ///
    /// Failure must be reported: data split across both names reads as a fresh install.
    fn restore_root(root: &Path, stale: &Path) -> Result<()> {
        for entry in std::fs::read_dir(root).context("failed to read the partially rebuilt root")? {
            let name = entry
                .context("failed to read a partially rebuilt root entry")?
                .file_name();
            std::fs::rename(root.join(&name), stale.join(&name))
                .with_context(|| format!("failed to put {name:?} back"))?;
        }
        std::fs::remove_dir(root).context("failed to remove the partially rebuilt root")?;
        std::fs::rename(stale, root).context("failed to restore the application data root")
    }

    fn take_directory_ownership(path: &Path, expected: PSID) -> Result<()> {
        let directory = open_no_reparse(path, true, WRITE_OWNER)?;
        let status = unsafe {
            SetSecurityInfo(
                directory.as_raw_handle(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                expected,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if status != 0 {
            return Err(std::io::Error::from_raw_os_error(status as i32))
                .context("failed to set the application data root owner");
        }
        Ok(())
    }

    fn owner_matches(directory: &std::fs::File, expected: PSID) -> Result<bool> {
        let mut owner = std::ptr::null_mut();
        let mut security = std::ptr::null_mut();
        let status = unsafe {
            GetSecurityInfo(
                directory.as_raw_handle(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                &mut owner,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut security,
            )
        };
        if status != 0 || security.is_null() {
            bail!("failed to inspect the application data root owner: Windows error {status}");
        }
        let security = LocalSecurityDescriptor(security);
        let matches = !owner.is_null() && unsafe { EqualSid(owner, expected) } != 0;
        drop(security);
        Ok(matches)
    }

    fn open_no_reparse(path: &Path, directory: bool, access: u32) -> Result<std::fs::File> {
        let wide = wide_path(path)?;
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error()).with_context(|| format!("failed to open {path:?}"));
        }
        let file = unsafe { std::fs::File::from_raw_handle(handle) };

        let mut information = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) } == 0 {
            return Err(std::io::Error::last_os_error()).with_context(|| format!("failed to inspect {path:?}"));
        }
        if information.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (information.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory
        {
            bail!("{path:?} is not the kind of object the owner repair expects");
        }
        Ok(file)
    }

    fn sid_to_string(sid: PSID) -> Result<String> {
        let mut value = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(sid, &mut value) } == 0 || value.is_null() {
            return Err(std::io::Error::last_os_error()).context("failed to format process SID");
        }
        let value = LocalWideString(value);
        let length = (0..).take_while(|index| unsafe { *value.0.add(*index) } != 0).count();
        String::from_utf16(unsafe { std::slice::from_raw_parts(value.0, length) })
            .context("process SID is not valid UTF-16")
    }

    fn encode_token(token: &[u8; TOKEN_BYTES]) -> String {
        let mut encoded = String::with_capacity(TOKEN_BYTES * 2);
        for byte in token {
            use std::fmt::Write as _;
            let _ = write!(encoded, "{byte:02x}");
        }
        encoded
    }

    fn wide_path(path: &Path) -> Result<Vec<u16>> {
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        if wide.contains(&0) {
            bail!("owner token path contains NUL");
        }
        wide.push(0);
        Ok(wide)
    }

    struct OwnedHandle(*mut c_void);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    struct LocalWideString(*mut u16);

    impl Drop for LocalWideString {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { LocalFree(self.0.cast()) };
            }
        }
    }

    struct LocalSecurityDescriptor(PSECURITY_DESCRIPTOR);

    impl LocalSecurityDescriptor {
        fn from_sid(sid: &str) -> Result<Self> {
            let sddl = format!("O:{sid}D:P(A;;FA;;;{sid})(A;;FA;;;SY)(A;;FA;;;BA)");
            let mut wide: Vec<u16> = sddl.encode_utf16().collect();
            wide.push(0);
            let mut descriptor = std::ptr::null_mut();
            if unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    wide.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    std::ptr::null_mut(),
                )
            } == 0
                || descriptor.is_null()
            {
                return Err(std::io::Error::last_os_error()).context("failed to build owner token security descriptor");
            }
            Ok(Self(descriptor))
        }

        fn owner(&self) -> Result<PSID> {
            let mut owner = std::ptr::null_mut();
            let mut defaulted = 0;
            if unsafe { GetSecurityDescriptorOwner(self.0, &mut owner, &mut defaulted) } == 0 || owner.is_null() {
                return Err(std::io::Error::last_os_error()).context("failed to read token descriptor owner");
            }
            Ok(owner)
        }

        fn apply_dacl(&self, handle: *mut c_void) -> Result<()> {
            let mut present = 0;
            let mut defaulted = 0;
            let mut dacl = std::ptr::null_mut();
            if unsafe { GetSecurityDescriptorDacl(self.0, &mut present, &mut dacl, &mut defaulted) } == 0
                || present == 0
                || dacl.is_null()
            {
                return Err(std::io::Error::last_os_error()).context("failed to read token descriptor DACL");
            }
            let status = unsafe {
                SetSecurityInfo(
                    handle,
                    SE_FILE_OBJECT,
                    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    dacl,
                    std::ptr::null(),
                )
            };
            if status != 0 {
                bail!("failed to restrict owner token DACL: Windows error {status}");
            }
            Ok(())
        }
    }

    impl Drop for LocalSecurityDescriptor {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { LocalFree(self.0) };
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::current_owner_credentials_for_root;
    use clash_verge_service_ipc::OwnerIdentity;

    #[cfg(unix)]
    #[test]
    fn unix_credentials_come_from_process_and_have_no_token() -> anyhow::Result<()> {
        let app_root = std::env::temp_dir();

        let credentials = current_owner_credentials_for_root(&app_root)?;

        assert_eq!(
            credentials.identity,
            OwnerIdentity::Unix {
                uid: unsafe { libc::geteuid() },
                gid: unsafe { libc::getegid() },
            }
        );
        assert_eq!(credentials.token, None);
        assert_eq!(
            std::path::PathBuf::from(credentials.app_data_dir),
            std::fs::canonicalize(app_root)?
        );
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn windows_credentials_use_stable_sid_and_private_token() -> anyhow::Result<()> {
        let app_root = std::env::temp_dir().join(format!("cvr-owner-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&app_root);
        std::fs::create_dir(&app_root)?;

        let first = current_owner_credentials_for_root(&app_root)?;
        let second = current_owner_credentials_for_root(&app_root)?;

        let OwnerIdentity::Windows { sid } = &first.identity else {
            anyhow::bail!("expected Windows owner identity");
        };
        assert!(sid.starts_with("S-1-5-"));
        assert_eq!(first.identity, second.identity);
        assert_eq!(first.token, second.token);
        assert_eq!(first.token.as_deref().map(str::len), Some(64));

        std::fs::remove_dir_all(app_root)?;
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn private_file_open_rejects_directories_and_reparse_points() -> anyhow::Result<()> {
        use super::{create_private_current_user_file, open_private_current_user_file};

        let root = std::env::temp_dir().join(format!("cvr-private-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root)?;

        let private_file = root.join("record.json");
        drop(create_private_current_user_file(&private_file)?);
        drop(open_private_current_user_file(&private_file)?);

        let directory = root.join("directory");
        std::fs::create_dir(&directory)?;
        assert!(open_private_current_user_file(&directory).is_err());

        let link = root.join("record-link.json");
        if let Err(error) = std::os::windows::fs::symlink_file(&private_file, &link) {
            if error.raw_os_error() == Some(1314) {
                std::fs::remove_dir_all(root)?;
                return Ok(());
            }
            return Err(error.into());
        }
        assert!(open_private_current_user_file(&link).is_err());

        std::fs::remove_file(link)?;
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
