#!/bin/bash
set -e

chmod +x /usr/bin/clash-verge-service-install
chmod +x /usr/bin/clash-verge-service-uninstall
chmod +x /usr/bin/clash-verge-service

SERVICE_UNIT="clash-verge-service.service"
SERVICE_UNIT_FILE="/etc/systemd/system/$SERVICE_UNIT"
# Read by the app, which offers a reinstall when the package could not keep the Service.
UPGRADE_MARKER="/run/clash-verge-service-upgrade"
# Read by /usr/bin/clash-verge-service-uninstall to keep the Service through the previous %preun.
TRANSACTION_RECORD="/run/clash-verge-service-rpm-upgrade"

# Set to the previous state when restoring it fails; the app shows it even if the Service is ready.
UNRESTORED_STATE=""

write_upgrade_marker() {
    (
        umask 022
        {
            printf 'id=%s\n' "$(date +%s%N)"
            if [ -n "$UNRESTORED_STATE" ]; then
                printf 'restore=%s\n' "$UNRESTORED_STATE"
            fi
        } >"$UPGRADE_MARKER"
    )
}

# Scriptlets run as children of the process running the rpm transaction; its start time
# keeps a stale record from matching a later process that reuses the PID.
record_transaction() {
    local start
    start="$(sed 's/.*) //' "/proc/$PPID/stat" | cut -d' ' -f20)"
    [ -n "$start" ] || return 1
    (umask 022 && printf '%s %s\n' "$PPID" "$start" >"$TRANSACTION_RECORD")
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
    local status=0 restored=yes
    if [ "$enabled" = "masked-runtime" ]; then
        systemctl unmask --runtime --quiet "$SERVICE_UNIT" || restored=no
    fi
    if ! CLASH_VERGE_SERVICE_GID="$gid" /usr/bin/clash-verge-service-install --install-service; then
        echo "Warning: reinstalling Clash Verge Service failed; Clash Verge will offer to reinstall it." >&2
        status=1
    fi
    case "$enabled" in
        disabled) systemctl disable --quiet "$SERVICE_UNIT" || restored=no ;;
        enabled-runtime) { systemctl disable --quiet "$SERVICE_UNIT" && systemctl enable --runtime --quiet "$SERVICE_UNIT"; } || restored=no ;;
        masked-runtime) systemctl mask --runtime --quiet "$SERVICE_UNIT" || restored=no ;;
    esac
    if [ "$active" = "no" ]; then
        systemctl stop "$SERVICE_UNIT" || restored=no
    fi
    if [ "$restored" = "no" ]; then
        UNRESTORED_STATE="${enabled:-unknown},$([ "$active" = yes ] && echo active || echo inactive)"
        echo "Warning: restoring the previous Clash Verge Service state ($UNRESTORED_STATE) failed; check it with systemctl." >&2
        status=1
    fi
    return "$status"
}

# Upgrades keep an existing Service current; first installs and explicit removals never add one.
# A symlinked unit is masked or managed by the administrator and is left alone.
# The previous %preun runs after this script; the record keeps it from removing the Service.
# Without a record that %preun removes the Service, so the marker makes the app offer a reinstall.
if [ "$1" -ge 2 ] && [ -d /run/systemd/system ] && [ -f "$SERVICE_UNIT_FILE" ] && [ ! -L "$SERVICE_UNIT_FILE" ]; then
    recorded=yes
    record_transaction || recorded=no
    gid="$(existing_service_gid)"
    if [ -z "$gid" ]; then
        echo "Warning: the Clash Verge Service group could not be resolved; Clash Verge will offer to reinstall the Service." >&2
        write_upgrade_marker
    elif reinstall_existing_service "$gid" && [ "$recorded" = yes ]; then
        rm -f "$UPGRADE_MARKER"
    else
        write_upgrade_marker
    fi
fi

# The enforcement file exists in both Enforcing and Permissive mode.
if [ ! -e /sys/fs/selinux/enforce ]; then
    exit 0
fi

if [ ! -x /usr/sbin/semanage ] || [ ! -x /usr/sbin/restorecon ]; then
    echo "Warning: persistent SELinux rules were not installed; install policycoreutils and policycoreutils-python-utils, then reinstall this package. The service installer repairs executable labels, but a system relabel can reset them." >&2
    exit 0
fi

# Keep these local rules on removal: they may predate this package or serve a standalone development service.
for service in clash-verge-service clash-verge-service-dev; do
    for directory in bin cores; do
        target="/var/lib/$service/$directory"
        if [ -L "/var/lib/$service" ] || [ -L "$target" ]; then
            echo "Refusing to relabel a symlinked service directory: $target" >&2
            exit 1
        fi
        spec="$target(/.*)?"
        # Older semanage versions reject -a when an exact rule already exists.
        if ! add_error="$(/usr/sbin/semanage fcontext -a -t bin_t "$spec" 2>&1)"; then
            if ! /usr/sbin/semanage fcontext -m -t bin_t "$spec"; then
                printf '%s\n' "$add_error" >&2
                exit 1
            fi
        fi
        if [ -d "$target" ]; then
            /usr/sbin/restorecon -R "$target"
        fi
    done
done
