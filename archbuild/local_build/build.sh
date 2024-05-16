read -p "rebuild deb package? (y/n): " rebuild
if [[ "$rebuild" =~ ^[Yy]$ ]]; then
    pnpm build -b deb
fi

CURRENT_SCRIPT_DIR=$(
    cd "$(dirname "$0")" || exit 1
    pwd
)
PARENT_DIR=$(dirname "$CURRENT_SCRIPT_DIR")
PROJECT_ROOT_DIR=$(dirname "$PARENT_DIR")
PROJECT_PACKAGEJSON_PATH="$PROJECT_ROOT_DIR/package.json"

VERSION=$(cat ${PROJECT_PACKAGEJSON_PATH} | jq '.version' | tr -d '"')
PROJECT_RELEASE_DEB_PATH="$PROJECT_ROOT_DIR/src-tauri/target/release/bundle/deb/clash-verge_${VERSION}_amd64.deb"

cp ${PROJECT_RELEASE_DEB_PATH} .

makepkg -fc

read -p "install now? (y/n): " yay_install

ARCH_PKG_VERSION=$(grep "^pkgver=" ${CURRENT_SCRIPT_DIR}/PKGBUILD | sed 's/^pkgver=//')
if [[ "$yay_install" =~ ^[Yy]$ ]]; then
    echo "installing..."
    yay -U clash-verge-rev-patch-alpha-bin-${ARCH_PKG_VERSION}-1-x86_64.pkg.tar.zst --noconfirm
    echo "install finished."
else
    echo "skip install."
fi
