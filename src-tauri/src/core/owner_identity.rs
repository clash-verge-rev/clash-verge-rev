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
pub(crate) fn secure_current_user_file(path: &Path) -> Result<()> {
    windows_owner::secure_file_path(path, &windows_owner::current_sid()?)
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

#[cfg(windows)]
pub(crate) fn current_user_pipe_sddl() -> Result<String> {
    let sid = windows_owner::current_sid()?;
    Ok(format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)(A;;GA;;;BA)"))
}

#[cfg(windows)]
mod windows_owner {
    use anyhow::{Context as _, Result, bail};
    use clash_verge_service_ipc::OWNER_TOKEN_FILE_NAME;
    use std::ffi::c_void;
    use std::io::{Read as _, Write as _};
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _};
    use std::path::Path;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_FILE_EXISTS, GENERIC_READ, GENERIC_WRITE, GetLastError, INVALID_HANDLE_VALUE, LocalFree,
    };
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SDDL_REVISION_1,
        SE_FILE_OBJECT, SetSecurityInfo,
    };
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION, EqualSid, GetAce, GetSecurityDescriptorControl,
        GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, GetTokenInformation, IsValidSid, IsWellKnownSid,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SE_DACL_PROTECTED,
        SECURITY_ATTRIBUTES, SetFileSecurityW, TOKEN_QUERY, TOKEN_USER, TokenUser, WinBuiltinAdministratorsSid,
        WinLocalSystemSid,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, CREATE_NEW, CreateFileW, FILE_ALL_ACCESS, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_DISK, GetFileInformationByHandle, GetFileType,
        OPEN_EXISTING, READ_CONTROL, WRITE_DAC,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    const TOKEN_BYTES: usize = 32;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;

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
        let mut attributes = SECURITY_ATTRIBUTES {
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
                &mut attributes,
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
        let mut attributes = SECURITY_ATTRIBUTES {
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
                &mut attributes,
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

    pub(super) fn secure_file_path(path: &Path, sid: &str) -> Result<()> {
        let descriptor = LocalSecurityDescriptor::from_sid(sid)?;
        let wide = wide_path(path)?;
        if unsafe {
            SetFileSecurityW(
                wide.as_ptr(),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor.0,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error()).context("failed to secure current-user file");
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
        std::os::windows::fs::symlink_file(&private_file, &link)?;
        assert!(open_private_current_user_file(&link).is_err());

        std::fs::remove_file(link)?;
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
