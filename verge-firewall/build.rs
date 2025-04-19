fn main() {
    let mut res = tauri_winres::WindowsResource::new();
    res.set_manifest_file("manifest.xml");
    res.compile().unwrap();
}
