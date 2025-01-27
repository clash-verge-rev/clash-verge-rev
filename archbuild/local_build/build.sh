# app name
readonly APP_NAME="clash-verge"
# dirs
CURRENT_SCRIPT_DIR=$(
    cd "$(dirname "$0")" || exit 1
    pwd
)
PARENT_DIR=$(dirname "$CURRENT_SCRIPT_DIR")
PROJECT_ROOT_DIR=$(dirname "$PARENT_DIR")
# get app version
VERSION=$(cat $PROJECT_ROOT_DIR/package.json | jq '.version' | tr -d '"')
# deb file name
DEB_FILE="${APP_NAME}_${VERSION}_amd64.deb"
# deb path
DEB_PATH="$PROJECT_ROOT_DIR/src-tauri/target/release/bundle/deb/${DEB_FILE}"
# arch build bundle name
ARCH_PKG_NAME=$(grep "^pkgname=" ${CURRENT_SCRIPT_DIR}/PKGBUILD | sed 's/^pkgname=//')
ARCH_BUNDLE_NAME="${ARCH_PKG_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"

# readonly vars
readonly CURRENT_SCRIPT_DIR
readonly PARENT_DIR
readonly PROJECT_ROOT_DIR

readonly VERSION
readonly DEB_FILE
readonly DEB_PATH

readonly ARCH_PKG_NAME
readonly ARCH_BUNDLE_NAME

# ask for deb build
read -p "rebuild deb package? (y/n): " rebuild
if [[ "$rebuild" =~ ^[Yy]$ || -z $rebuild ]]; then
    pnpm build -b deb
    cp "${DEB_PATH}" . || exit 1
else
    if [[ -f "./${DEB_FILE}" ]]; then
        echo -e "\e[33m skip rebuild, use current deb. (${DEB_FILE})"
    else
        echo -e "\e[31m not found deb package, exit."
        exit 0
    fi
fi

# change version
sed -i "s/pkgver=.*/pkgver=${VERSION}/" ${CURRENT_SCRIPT_DIR}/PKGBUILD
# update checksums
sed -i "s/sha256sums_x86_64=.*/sha256sums_x86_64=(\"$(sha256sum "${DEB_FILE}" | awk '{print $1}')\")/" ${CURRENT_SCRIPT_DIR}/PKGBUILD

# starting build arch package
makepkg -fc

# check if arch bundle package exist
if [[ -f "./${ARCH_BUNDLE_NAME}" ]]; then
    echo -e "\e[32m build success."
else
    echo -e "\e[31m not found arch bundle package, exit."
    exit 0
fi

# ask for install
read -p "install now? (y/n): " yay_install
if [[ "$yay_install" =~ ^[Yy]$ || -z $yay_install ]]; then
    echo "installing..."
    yay -U $ARCH_BUNDLE_NAME
    echo -e "\e[32m install finished."
else
    echo -e "\e[32m skip install."
fi
