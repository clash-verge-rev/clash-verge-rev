#!/bin/bash
chmod +x /usr/bin/clash-verge-service-install
chmod +x /usr/bin/clash-verge-service-uninstall
chmod +x /usr/bin/clash-verge-service

. /etc/os-release

if [ $ID == "deepin" ]; then
    PACKAGE_NAME="$DPKG_MAINTSCRIPT_PACKAGE"
    echo "Fixing deepin desktop files"
    for f in $(dpkg -L "$PACKAGE_NAME" |grep ".desktop")
    do
        sed -i "s/MimeType=x-scheme-handler/clash;//g" "$f"
    done
fi
