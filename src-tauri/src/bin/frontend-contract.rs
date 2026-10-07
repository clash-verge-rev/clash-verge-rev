fn main() -> Result<(), Box<dyn std::error::Error>> {
    app_lib::ipc::builder().export(
        specta_typescript::Typescript::default(),
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/services/bindings.ts"),
    )?;
    Ok(())
}
