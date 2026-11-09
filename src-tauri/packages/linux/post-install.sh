#!/bin/bash
chmod +x /usr/bin/clash-verge-service-install
chmod +x /usr/bin/clash-verge-service-uninstall
chmod +x /usr/lib/clash-verge-rev/clash-verge-service-uninstall
chmod +x /usr/bin/clash-verge-service

SERVICE_UNIT="clash-verge-service.service"
SERVICE_UNIT_FILE="/etc/systemd/system/$SERVICE_UNIT"
# Read by the app, which offers a reinstall when the package could not keep the Service.
UPGRADE_MARKER="/run/clash-verge-service-upgrade"

write_upgrade_marker() {
    (umask 022 && printf 'gid=%s\nid=%s\n' "$1" "$(date +%s%N)" >"$UPGRADE_MARKER")
}

existing_service_gid() {
    local group
    group="$(sed -n 's/^Group=//p' "$SERVICE_UNIT_FILE" | head -n 1)"
    if [ -n "$group" ]; then
        getent group "$group" | cut -d: -f3
    fi
    return 0
}

# Failures only warn: dpkg and rpm cannot restore the previous Service from a failed postinst,
# and a failing script would leave the package unconfigured or make the app report a failed update.
# The installer always enables and starts the unit, so the previous enablement and activity are restored.
reinstall_existing_service() {
    local gid="$1" enabled active=no
    enabled="$(systemctl is-enabled "$SERVICE_UNIT" 2>/dev/null)"
    if systemctl is-active --quiet "$SERVICE_UNIT"; then
        active=yes
    fi
    if [ "$enabled" = "masked-runtime" ]; then
        systemctl unmask --runtime --quiet "$SERVICE_UNIT"
    fi
    local status=0
    if ! CLASH_VERGE_SERVICE_GID="$gid" /usr/bin/clash-verge-service-install --install-service; then
        echo "Warning: reinstalling Clash Verge Service failed; Clash Verge will offer to reinstall it." >&2
        status=1
    fi
    case "$enabled" in
        disabled) systemctl disable --quiet "$SERVICE_UNIT" ;;
        masked-runtime) systemctl mask --runtime --quiet "$SERVICE_UNIT" ;;
    esac
    if [ "$active" = "no" ]; then
        systemctl stop "$SERVICE_UNIT"
    fi
    return "$status"
}

# Upgrades keep an existing Service current; first installs and explicit removals never add one.
# A symlinked unit is masked or managed by the administrator and is left alone.
if [ "$1" = "configure" ] && [ -n "$2" ] && [ -d /run/systemd/system ] &&
    [ -f "$SERVICE_UNIT_FILE" ] && [ ! -L "$SERVICE_UNIT_FILE" ]; then
    gid="$(existing_service_gid)"
    if [ -z "$gid" ]; then
        echo "Warning: the Clash Verge Service group could not be resolved; Clash Verge will offer to reinstall the Service." >&2
        write_upgrade_marker ""
    elif reinstall_existing_service "$gid"; then
        rm -f "$UPGRADE_MARKER"
    else
        write_upgrade_marker "$gid"
    fi
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
