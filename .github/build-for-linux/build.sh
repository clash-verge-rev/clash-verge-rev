pnpm install
pnpm check $INPUT_TARGET
sed -i "s/#openssl/openssl={version=\"0.10\",features=[\"vendored\"]}/g" src-tauri/Cargo.toml
if [ "$INPUT_TARGET" = "x86_64-unknown-linux-gnu" ]; then
    pnpm build --target $INPUT_TARGET
else
    pnpm build --target $INPUT_TARGET -b deb
fi
