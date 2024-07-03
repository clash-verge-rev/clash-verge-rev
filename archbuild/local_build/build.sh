CURRENT_SCRIPT_DIR=$(
    cd "$(dirname "$0")" || exit 1
    pwd
)
PARENT_DIR=$(dirname "$CURRENT_SCRIPT_DIR")
PROJECT_ROOT_DIR=$(dirname "$PARENT_DIR")
PROJECT_PACKAGEJSON_PATH="$PROJECT_ROOT_DIR/package.json"

VERSION=$(cat ${PROJECT_PACKAGEJSON_PATH} | jq '.version' | tr -d '"')
DEB_NAME="clash-verge_${VERSION}_amd64.deb"
PROJECT_RELEASE_DEB_PATH="$PROJECT_ROOT_DIR/src-tauri/target/release/bundle/deb/${DEB_NAME}"

read -p "rebuild deb package? (y/n): " rebuild
if [[ "$rebuild" =~ ^[Yy]$ ]]; then
    pnpm build -b deb
    cp ${PROJECT_RELEASE_DEB_PATH} . || exit 1
else
    if [[ -f "./${DEB_NAME}" ]]; then
        echo -e "\e[33m skip rebuild, use current deb."
    else
        echo -e "\e[31m not found deb package, exit."
        exit 0
    fi
fi

makepkg -fc

read -p "install now? (y/n): " yay_install

ARCH_PKG_VERSION=$(grep "^pkgver=" ${CURRENT_SCRIPT_DIR}/PKGBUILD | sed 's/^pkgver=//')
if [[ "$yay_install" =~ ^[Yy]$ ]]; then
    echo "installing..."
    yay -U clash-verge-rev-alpha-bin-${ARCH_PKG_VERSION}-1-x86_64.pkg.tar.zst
    echo -e "\e[32m install finished."
else
    echo -e "\e[32m skip install."
fi
