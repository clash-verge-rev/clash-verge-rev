use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command as StdCommand,
};

const RELEASE_BUNDLE_ID: &str = "io.github.clash-verge-rev.clash-verge-rev";
const DEV_BUNDLE_ID: &str = "io.github.clash-verge-rev.clash-verge-rev.dev";

fn main() {
    #[cfg(feature = "clippy")]
    {
        println!("cargo:warning=Skipping tauri_build during Clippy");
    }

    if let Err(err) = setup_macos_sysproxy_helper() {
        println!("cargo:warning=failed to setup macOS system proxy helper: {err}");
    }

    #[cfg(not(feature = "clippy"))]
    tauri_build::build();
}

fn setup_macos_sysproxy_helper() -> Result<(), String> {
    let target_os = env::var("CARGO_CFG_TARGET_OS").map_err(|e| e.to_string())?;
    if target_os != "macos" {
        return Ok(());
    }

    let is_dev = env::var("CARGO_FEATURE_VERGE_DEV").is_ok();
    let app_bundle_id = if is_dev { DEV_BUNDLE_ID } else { RELEASE_BUNDLE_ID };
    let helper_label = format!("{app_bundle_id}.proxyhelper");
    let team_id = env::var("APPLE_TEAM_ID").unwrap_or_else(|_| "[TEAM_ID]".into());

    let crate_dir = env::current_dir().map_err(|e| e.to_string())?;
    let assets_dir = crate_dir.join("native/macos/proxy-helper");
    let resources_dir = crate_dir.join("resources/proxy-helper");
    let out_dir = PathBuf::from(env::var("OUT_DIR").map_err(|e| e.to_string())?);
    let generated_dir = out_dir.join("sysproxy-helper");
    fs::create_dir_all(&generated_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&resources_dir).map_err(|e| e.to_string())?;

    let helper_swift = assets_dir.join("helper.swift");
    let bridge_swift = assets_dir.join("bridge.swift");
    let helper_info_tpl = assets_dir.join("helper_info.plist.template");
    let helper_launchd_tpl = assets_dir.join("helper_launchd.plist.template");
    let app_info_tpl = crate_dir.join("packages/macos/info_merge.plist.template");
    let app_info_out = crate_dir.join("packages/macos/info_generated.plist");

    for p in [
        &helper_swift,
        &bridge_swift,
        &helper_info_tpl,
        &helper_launchd_tpl,
        &app_info_tpl,
    ] {
        println!("cargo:rerun-if-changed={}", p.display());
    }
    println!("cargo:rerun-if-env-changed=APPLE_TEAM_ID");

    let helper_info = render_template(
        &fs::read_to_string(&helper_info_tpl).map_err(|e| e.to_string())?,
        app_bundle_id,
        &helper_label,
        &team_id,
    );
    let helper_launchd = render_template(
        &fs::read_to_string(&helper_launchd_tpl).map_err(|e| e.to_string())?,
        app_bundle_id,
        &helper_label,
        &team_id,
    );
    let app_info = render_template(
        &fs::read_to_string(&app_info_tpl).map_err(|e| e.to_string())?,
        app_bundle_id,
        &helper_label,
        &team_id,
    );

    let helper_info_path = generated_dir.join("helper_info.plist");
    let helper_launchd_path = generated_dir.join("helper_launchd.plist");
    fs::write(&helper_info_path, helper_info).map_err(|e| e.to_string())?;
    fs::write(&helper_launchd_path, helper_launchd).map_err(|e| e.to_string())?;
    fs::write(&app_info_out, app_info).map_err(|e| e.to_string())?;

    build_helper_binary(
        &helper_swift,
        &helper_info_path,
        &helper_launchd_path,
        &resources_dir.join(&helper_label),
    )?;
    build_bridge_binary(&bridge_swift, &resources_dir.join("proxy-helper-bridge"))?;
    Ok(())
}

fn render_template(content: &str, app_bundle_id: &str, helper_label: &str, team_id: &str) -> String {
    content
        .replace("__APP_BUNDLE_ID__", app_bundle_id)
        .replace("__HELPER_LABEL__", helper_label)
        .replace("__TEAM_ID__", team_id)
}

fn build_helper_binary(
    source: &Path,
    info_plist: &Path,
    launchd_plist: &Path,
    out_binary: &Path,
) -> Result<(), String> {
    let arm = out_binary.with_extension("arm64");
    let x64 = out_binary.with_extension("x86_64");

    swiftc_helper_arch(source, info_plist, launchd_plist, "arm64-apple-macos11.0", &arm)?;
    swiftc_helper_arch(source, info_plist, launchd_plist, "x86_64-apple-macos11.0", &x64)?;
    run_cmd(
        StdCommand::new("xcrun")
            .arg("lipo")
            .arg("-create")
            .arg("-output")
            .arg(out_binary)
            .arg(&arm)
            .arg(&x64),
        "lipo helper binary",
    )?;
    fs::remove_file(&arm).map_err(|e| e.to_string())?;
    fs::remove_file(&x64).map_err(|e| e.to_string())?;
    make_executable(out_binary)?;
    Ok(())
}

fn swiftc_helper_arch(
    source: &Path,
    info_plist: &Path,
    launchd_plist: &Path,
    target: &str,
    out: &Path,
) -> Result<(), String> {
    run_cmd(
        StdCommand::new("xcrun")
            .arg("swiftc")
            .arg("-O")
            .arg("-target")
            .arg(target)
            .arg(source)
            .arg("-o")
            .arg(out)
            .arg("-Xlinker")
            .arg("-sectcreate")
            .arg("-Xlinker")
            .arg("__TEXT")
            .arg("-Xlinker")
            .arg("__info_plist")
            .arg("-Xlinker")
            .arg(info_plist)
            .arg("-Xlinker")
            .arg("-sectcreate")
            .arg("-Xlinker")
            .arg("__TEXT")
            .arg("-Xlinker")
            .arg("__launchd_plist")
            .arg("-Xlinker")
            .arg(launchd_plist),
        &format!("swiftc helper {target}"),
    )
}

fn build_bridge_binary(source: &Path, out_binary: &Path) -> Result<(), String> {
    let arm = out_binary.with_extension("arm64");
    let x64 = out_binary.with_extension("x86_64");

    swiftc_bridge_arch(source, "arm64-apple-macos11.0", &arm)?;
    swiftc_bridge_arch(source, "x86_64-apple-macos11.0", &x64)?;
    run_cmd(
        StdCommand::new("xcrun")
            .arg("lipo")
            .arg("-create")
            .arg("-output")
            .arg(out_binary)
            .arg(&arm)
            .arg(&x64),
        "lipo bridge binary",
    )?;
    fs::remove_file(&arm).map_err(|e| e.to_string())?;
    fs::remove_file(&x64).map_err(|e| e.to_string())?;
    make_executable(out_binary)?;
    Ok(())
}

fn swiftc_bridge_arch(source: &Path, target: &str, out: &Path) -> Result<(), String> {
    run_cmd(
        StdCommand::new("xcrun")
            .arg("swiftc")
            .arg("-O")
            .arg("-target")
            .arg(target)
            .arg(source)
            .arg("-o")
            .arg(out),
        &format!("swiftc bridge {target}"),
    )
}

fn run_cmd(cmd: &mut StdCommand, desc: &str) -> Result<(), String> {
    let output = cmd.output().map_err(|e| format!("{desc}: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let details = if !stderr.trim().is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };
    Err(format!("{desc} failed: {details}"))
}

fn make_executable(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut perms = metadata.permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        perms.set_mode(0o755);
    }
    fs::set_permissions(path, perms).map_err(|e| e.to_string())
}
