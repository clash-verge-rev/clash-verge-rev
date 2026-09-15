use crate::{Action, Backend, Mode, Status};
use serde::Deserialize;
use std::{
    borrow::Cow,
    ffi::{CStr, CString},
    fs, mem,
    os::fd::AsRawFd as _,
    os::unix::fs::PermissionsExt as _,
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader},
    net::UnixListener,
    time::timeout,
};

struct Native {
    path: unsafe extern "C" fn() -> *mut libc::c_char,
    authenticate: unsafe extern "C" fn(i32) -> bool,
    reload: unsafe extern "C" fn(),
}
static NATIVE: OnceLock<Native> = OnceLock::new();

fn load_native() -> anyhow::Result<Native> {
    let executable = std::env::current_exe()?;
    let contents = executable
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| anyhow::anyhow!("Not an app bundle"))?;
    let path = CString::new(
        contents
            .join("Frameworks/VergeWidgetBridge.dylib")
            .as_os_str()
            .as_encoded_bytes(),
    )?;
    unsafe {
        let library = libc::dlopen(path.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
        anyhow::ensure!(!library.is_null(), "Widget bridge unavailable");
        let path = libc::dlsym(library, c"verge_widget_path".as_ptr());
        let authenticate = libc::dlsym(library, c"verge_widget_authenticate".as_ptr());
        let reload = libc::dlsym(library, c"verge_widget_reload".as_ptr());
        anyhow::ensure!(
            !path.is_null() && !authenticate.is_null() && !reload.is_null(),
            "Invalid widget bridge"
        );
        Ok(Native {
            path: mem::transmute::<*mut libc::c_void, unsafe extern "C" fn() -> *mut libc::c_char>(path),
            authenticate: mem::transmute::<*mut libc::c_void, unsafe extern "C" fn(i32) -> bool>(authenticate),
            reload: mem::transmute::<*mut libc::c_void, unsafe extern "C" fn()>(reload),
        })
    }
}

static MUTATING: AtomicBool = AtomicBool::new(false);

pub fn reload() {
    if MUTATING.load(Ordering::Acquire) {
        return;
    }
    if let Some(native) = NATIVE.get() {
        unsafe { (native.reload)() };
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request<'a> {
    #[serde(borrow)]
    action: Cow<'a, str>,
    #[serde(borrow)]
    value: Option<RequestValue<'a>>,
}

#[derive(Deserialize)]
#[serde(transparent)]
struct RequestValue<'a>(#[serde(borrow)] Cow<'a, str>);

impl Request<'_> {
    fn action(&self) -> Result<Option<Action>, &'static str> {
        match (self.action.as_ref(), self.value.as_ref().map(|value| value.0.as_ref())) {
            ("status", None) => Ok(None),
            ("mode", Some("rule")) => Ok(Some(Action::Mode(Mode::Rule))),
            ("mode", Some("global")) => Ok(Some(Action::Mode(Mode::Global))),
            ("mode", Some("direct")) => Ok(Some(Action::Mode(Mode::Direct))),
            ("tun", Some(value @ ("true" | "false"))) => Ok(Some(Action::Tun(value == "true"))),
            ("proxy", Some(value @ ("true" | "false"))) => Ok(Some(Action::Proxy(value == "true"))),
            _ => Err("Invalid widget request"),
        }
    }
}

async fn serve(backend: impl Backend) -> anyhow::Result<()> {
    let native = load_native()?;
    let raw = unsafe { (native.path)() };
    anyhow::ensure!(!raw.is_null(), "App Group container unavailable");
    let path = unsafe { CStr::from_ptr(raw).to_string_lossy().into_owned() };
    unsafe { libc::free(raw.cast()) };
    // A second process must not unlink the live app's listener.
    if tokio::net::UnixStream::connect(&path).await.is_ok() {
        anyhow::bail!("Widget listener already running");
    }
    match fs::remove_file(&path) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.into()),
    }
    let listener = UnixListener::bind(&path)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    let _ = NATIVE.set(native);
    reload();
    let mut last_error = None;
    let mut pending = None;
    loop {
        let (stream, _) = listener.accept().await?;
        let Some(native) = NATIVE.get() else { break };
        if !unsafe { (native.authenticate)(stream.as_raw_fd()) } {
            continue;
        }
        // Serialize widget mutations; never cancel a backend transaction on client timeout.
        let mut stream = BufReader::new(stream);
        let mut line = Vec::new();
        let read = timeout(
            Duration::from_secs(2),
            (&mut stream).take(1024).read_until(b'\n', &mut line),
        )
        .await;
        if !matches!(read, Ok(Ok(_))) || line.last() != Some(&b'\n') {
            continue;
        }
        let request = match serde_json::from_slice::<Request>(&line) {
            Ok(request) => request,
            Err(_) => continue,
        };
        let action = match request.action() {
            Ok(action) => action,
            Err(_) => continue,
        };
        let changed = action.is_some();
        // Coalesce hooks across the whole transaction, including errors and disconnected clients.
        MUTATING.store(changed, Ordering::Release);
        let refresh = scopeguard::guard(changed, |changed| {
            MUTATING.store(false, Ordering::Release);
            if changed {
                reload();
            }
        });
        // Mutations reply without re-reading state so the widget repaints one round trip
        // sooner; the status read after the reload confirms the pending action.
        let mut reply = match action {
            Some(action) => {
                match backend.apply(action).await {
                    Ok(()) => {
                        last_error = None;
                        pending = Some(action);
                    }
                    Err(error) => {
                        pending = None;
                        last_error = Some(error);
                    }
                }
                Status::default()
            }
            None => {
                let state = backend.snapshot().await;
                if let Some(action) = pending.take()
                    && !state.confirms(action)
                {
                    last_error = Some("widget.failed".into());
                }
                state
            }
        };
        if action.is_some() {
            reply.language = backend.language().await;
        }
        reply.error = last_error.take();
        let serialized = serde_json::to_vec(&reply);
        last_error = reply.error.take();
        let mut bytes = serialized?;
        bytes.push(b'\n');
        let _ = timeout(Duration::from_secs(2), stream.get_mut().write_all(&bytes)).await;
        drop(refresh);
    }
    Ok(())
}

pub fn start(backend: impl Backend) {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::Relaxed) {
        return;
    }
    // Darwin 23 is macOS 14; older hosts must never load the WidgetKit bridge.
    let mut version = [0u8; 64];
    let mut length = version.len();
    let result = unsafe {
        libc::sysctlbyname(
            c"kern.osrelease".as_ptr(),
            version.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    let major = std::str::from_utf8(&version)
        .ok()
        .and_then(|v| v.split('.').next()?.parse::<u32>().ok());
    if result != 0 || major.is_none_or(|major| major < 23) {
        return;
    }
    tokio::spawn(async move {
        if let Err(error) = serve(backend).await {
            log::warn!("Widget unavailable: {error:#}");
        }
    });
}
