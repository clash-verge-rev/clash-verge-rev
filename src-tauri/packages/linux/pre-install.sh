#!/bin/bash
# Previous packages' prerm uninstalls the Service before this script runs, deleting the unit that names
# its group. The journal still shows whether this dpkg run stopped a running Service and which group it ran with;
# the postinst reinstalls from that evidence, and without it nothing is installed.
SERVICE_UNIT="clash-verge-service.service"
UPGRADE_MARKER="/run/clash-verge-service-upgrade"
# systemd's "unit stopped" catalog entry.
UNIT_STOPPED_MESSAGE_ID="9d1aaa27d60140bd96365438aad20286"

dpkg_start_epoch() {
    local stat start btime ticks
    read -r stat <"/proc/$PPID/stat" || return 1
    start="$(printf '%s\n' "${stat##*) }" | cut -d' ' -f20)"
    btime="$(sed -n 's/^btime //p' /proc/stat)"
    ticks="$(getconf CLK_TCK)"
    [ -n "$start" ] && [ -n "$btime" ] && [ -n "$ticks" ] || return 1
    echo $((btime + start / ticks))
}

if [ "$1" = "upgrade" ] && [ ! -e "/etc/systemd/system/$SERVICE_UNIT" ] && [ -d /run/systemd/system ] &&
    [ "$(cat "/proc/$PPID/comm" 2>/dev/null)" = "dpkg" ] && command -v journalctl >/dev/null; then
    since="$(dpkg_start_epoch)"
    if [ -n "$since" ] &&
        [ -n "$(journalctl -q --no-pager --since "@$since" _PID=1 UNIT="$SERVICE_UNIT" MESSAGE_ID="$UNIT_STOPPED_MESSAGE_ID" -o cat 2>/dev/null)" ]; then
        # The truncated process name excludes cores the Service spawned in its cgroup.
        gid="$(journalctl -q --no-pager -b _SYSTEMD_UNIT="$SERVICE_UNIT" _COMM=clash-verge-ser -n 1 -o export 2>/dev/null |
            sed -n 's/^_GID=//p')"
        if [ -z "$gid" ] || [ "$gid" = "0" ] || ! getent group "$gid" >/dev/null; then
            gid=""
        fi
        (umask 022 && printf 'gid=%s\nid=%s\n' "$gid" "$(date +%s%N)" >"$UPGRADE_MARKER")
    fi
fi
exit 0
