fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let output = args
        .next()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/services/bindings.ts"));
    if args.next().is_some() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "expected at most one output path").into());
    }
    app_lib::ipc::builder().export(specta_typescript::Typescript::default(), output)?;
    Ok(())
}
