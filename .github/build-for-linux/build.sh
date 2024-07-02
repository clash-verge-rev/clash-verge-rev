pnpm install
pnpm check $INPUT_TARGET
sed -i "s/#openssl/openssl={version=\"0.10\",features=[\"vendored\"]}/g" src-tauri/Cargo.toml

pnpm build --target $INPUT_TARGET
