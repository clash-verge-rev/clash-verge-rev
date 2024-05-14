CURRENT_SCRIPT_DIR=$(
    cd "$(dirname "$0")" || exit 1
    pwd
)
PARENT_DIR=$(dirname "$CURRENT_SCRIPT_DIR")
PROJECT_ROOT_DIR=$(dirname "$PARENT_DIR")
PROJECT_PACKAGEJSON_PATH="$PROJECT_ROOT_DIR/package.json"

VERSION=$(cat ${PROJECT_PACKAGEJSON_PATH} | jq '.version' | tr -d '"')
PROJECT_RELEASE_DEB_PATH="$PROJECT_ROOT_DIR/src-tauri/target/release/bundle/deb/clash-verge_${VERSION}_amd64.deb"

if [ -e "${PROJECT_RELEASE_DEB_PATH}" ]; then
    cp ${PROJECT_ROOT_DIR}/src-tauri/target/release/bundle/deb/clash-verge_${VERSION}_amd64.deb .
else
    pnpm build -b deb
fi

makepkg -fc
