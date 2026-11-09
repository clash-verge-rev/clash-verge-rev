#!/bin/bash
set -e

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

# Upgrades keep an existing Service current; first installs never add one. No success is reported:
# a previous package whose %preun uninstalls unconditionally still removes the Service afterwards.
if [ "$1" -ge 2 ]; then
    reinstall_existing_service
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
