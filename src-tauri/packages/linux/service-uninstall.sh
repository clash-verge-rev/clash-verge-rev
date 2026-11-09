#!/bin/sh
# Installed as /usr/bin/clash-verge-service-uninstall. During an rpm upgrade the new %post
# reinstalls an existing Service before the previous package's %preun runs, and released
# %preun scripts uninstall it unconditionally through this path. Skip only that call: one
# made by a scriptlet of the transaction that %post recorded.
RECORD=/run/clash-verge-service-rpm-upgrade
UNINSTALLER=/usr/lib/clash-verge-rev/clash-verge-service-uninstall

# Fields after the parenthesised command name, which may itself contain spaces.
stat_field() {
    sed 's/.*) //' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f"$2"
}

if [ -f "$RECORD" ] && [ ! -L "$RECORD" ] && read -r txn_pid txn_start <"$RECORD" && [ -n "$txn_start" ]; then
    pid=$PPID
    depth=0
    while [ "$depth" -lt 4 ] && [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
        if [ "$pid" = "$txn_pid" ] && [ "$(stat_field "$pid" 20)" = "$txn_start" ]; then
            rm -f "$RECORD"
            echo "Keeping the Clash Verge Service through this upgrade."
            exit 0
        fi
        pid="$(stat_field "$pid" 2)"
        depth=$((depth + 1))
    done
fi

exec "$UNINSTALLER" "$@"
