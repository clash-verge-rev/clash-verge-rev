#!/bin/bash
# Previous packages' prerm uninstalls the Service before this script runs, deleting the unit that names
# its group. The journal still shows whether this dpkg run stopped a running Service and which group that
# invocation ran with; the postinst reinstalls only from that evidence.
SERVICE_UNIT="clash-verge-service.service"
UPGRADE_EVIDENCE="/run/clash-verge-service-upgrade-evidence"
# systemd's "unit stopped" catalog entry; restart jobs share it, so JOB_TYPE is required too.
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

# Only a prerm that uninstalls on every invocation explains a missing unit during an upgrade.
old_prerm_uninstalls() {
    local prerm="${DPKG_ADMINDIR:-/var/lib/dpkg}/info/$DPKG_MAINTSCRIPT_PACKAGE.prerm"
    [ -n "$DPKG_MAINTSCRIPT_PACKAGE" ] && [ -f "$prerm" ] &&
        grep -qx '/usr/bin/clash-verge-service-uninstall' "$prerm" && ! grep -q 'upgrade' "$prerm"
}

rm -f "$UPGRADE_EVIDENCE"
if [ "$1" = "upgrade" ] && [ -n "$2" ] && [ ! -e "/etc/systemd/system/$SERVICE_UNIT" ] &&
    [ -d /run/systemd/system ] && [ "$(cat "/proc/$PPID/comm" 2>/dev/null)" = "dpkg" ] &&
    command -v journalctl >/dev/null && old_prerm_uninstalls; then
    since="$(dpkg_start_epoch)"
    invocation=""
    if [ -n "$since" ]; then
        invocation="$(journalctl -q --no-pager --since "@$since" _PID=1 UNIT="$SERVICE_UNIT" \
            MESSAGE_ID="$UNIT_STOPPED_MESSAGE_ID" JOB_TYPE=stop JOB_RESULT=done -n 1 -o export 2>/dev/null |
            sed -n 's/^INVOCATION_ID=//p')"
    fi
    if printf '%s' "$invocation" | grep -qx '[0-9a-f]\{32\}'; then
        # Stdout entries carry the credentials systemd connected the stream with, which are the unit's Group=.
        gid="$(journalctl -q --no-pager _SYSTEMD_INVOCATION_ID="$invocation" _SYSTEMD_UNIT="$SERVICE_UNIT" \
            _TRANSPORT=stdout -n 1 -o export 2>/dev/null | sed -n 's/^_GID=//p')"
        if [ -z "$gid" ] || [ "$gid" = "0" ] || ! getent group "$gid" >/dev/null; then
            gid=""
        fi
        echo "Clash Verge Service invocation $invocation was removed by the previous package; it will be reinstalled."
        (umask 022 && printf 'old=%s\ngid=%s\n' "$2" "$gid" >"$UPGRADE_EVIDENCE")
    fi
fi
exit 0
