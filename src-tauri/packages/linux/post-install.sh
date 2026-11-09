#!/bin/bash
chmod +x /usr/bin/clash-verge-service-install
chmod +x /usr/bin/clash-verge-service-uninstall
chmod +x /usr/bin/clash-verge-service

# Failures only warn: dpkg and rpm cannot restore the previous Service from a failed postinst,
# and a failing script would leave the upgraded package unconfigured or report the update as failed.
reinstall_existing_service() {
    local unit="/etc/systemd/system/clash-verge-service.service"
    # Only a unit kept by an upgrade-aware removal script shows the Service existed before this upgrade.
    if [ ! -f "$unit" ] || [ -L "$unit" ]; then
        return 0
    fi
    if [ ! -d /run/systemd/system ]; then
        echo "Warning: systemd is not running, so Clash Verge Service was not reinstalled; reinstall it from Clash Verge." >&2
        return 0
    fi
    if ! systemctl is-enabled --quiet clash-verge-service.service; then
        echo "Clash Verge Service is disabled; leaving it unchanged." >&2
        return 0
    fi
    # Package managers run without the invoking user's identity, so keep the group that may use the Service.
    local group gid
    group="$(sed -n 's/^Group=//p' "$unit" | head -n 1)"
    gid=""
    if [ -n "$group" ]; then
        gid="$(getent group "$group" | cut -d: -f3)"
    fi
    if [ -z "$gid" ]; then
        echo "Warning: the Clash Verge Service group '$group' could not be resolved, so the Service was not reinstalled; reinstall it from Clash Verge." >&2
        return 0
    fi
    if ! CLASH_VERGE_SERVICE_GID="$gid" /usr/bin/clash-verge-service-install --install-service; then
        echo "Warning: reinstalling Clash Verge Service failed; reinstall it from Clash Verge." >&2
    fi
}

# Upgrades keep an existing Service current; first installs never add one.
if [ "$1" = "configure" ] && [ -n "$2" ]; then
    reinstall_existing_service
fi

. /etc/os-release

if [ "$ID" = "deepin" ]; then
    PACKAGE_NAME="$DPKG_MAINTSCRIPT_PACKAGE"
    DESKTOP_FILES=$(dpkg -L "$PACKAGE_NAME" 2>/dev/null | grep "\.desktop$")
    echo "$DESKTOP_FILES" | while IFS= read -r f; do
        if [ "$(basename "$f")" == "Clash Verge.desktop" ]; then
            echo "Fixing deepin desktop file"
            mv -vf "$f" "/usr/share/applications/clash-verge.desktop"
        fi
    done
fi
