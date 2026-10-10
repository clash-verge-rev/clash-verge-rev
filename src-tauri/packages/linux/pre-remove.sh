#!/bin/bash

case "$1" in
    upgrade|failed-upgrade|1)
        # Package upgrades must keep the installed service registered.
        ;;
    *)
        /usr/bin/clash-verge-service-uninstall
        ;;
esac

. /etc/os-release

if [ "$ID" = "deepin" ]; then
    if [ -f "/usr/share/applications/clash-verge.desktop" ]; then
        echo "Removing deepin desktop file"
        rm -vf "/usr/share/applications/clash-verge.desktop"
    fi
fi
