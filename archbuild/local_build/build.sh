VERSION=$(cat ../../package.json | jq '.version' | tr -d '"')
cp ../../src-tauri/target/release/bundle/deb/clash-verge_${VERSION}_amd64.deb .

makepkg -fc