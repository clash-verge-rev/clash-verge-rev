#!/bin/bash
set -e

chmod +x /usr/bin/clash-verge-service-install
chmod +x /usr/bin/clash-verge-service-uninstall
chmod +x /usr/bin/clash-verge-service

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
