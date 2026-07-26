#!/bin/bash

# Resolve the network service name for a given device (e.g. en0).
function network_service_for_device() {
    local device=$1
    networksetup -listnetworkserviceorder | awk -v dev="$device" '
        /^\([0-9]+\) /{service=$0; sub(/^\([0-9]+\) /, "", service)}
        /\(Hardware Port:/{interface=$NF; sub(/\)/, "", interface); if (interface == dev) {print service; exit}}
    '
}

# Restore the saved DNS servers for a single network service.
function restore_dns() {
    local network_service=$1
    local original_dns=$2

    if [ "$original_dns" = "empty" ] || [ -z "$original_dns" ]; then
        networksetup -setdnsservers "$network_service" empty
        return
    fi

    local -a dns_servers
    original_dns=${original_dns//$'\n'/ }
    read -r -a dns_servers <<<"$original_dns"
    networksetup -setdnsservers "$network_service" "${dns_servers[@]}"
}

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <state directory> <legacy state file>"
    exit 1
fi

state_dir=$1
legacy_state_file=$2
restore_failed=false

# Restore every network service we previously managed, keyed by its own state
# file. This is what keeps a service that went offline (e.g. Wi-Fi while on
# Ethernet) from being stranded with the TUN DNS still applied.
for state_file in "$state_dir"/*.state; do
    [ -e "$state_file" ] || continue

    IFS= read -r network_service <"$state_file"
    original_dns=$(tail -n +2 "$state_file")
    if [ -z "$network_service" ] || ! restore_dns "$network_service" "$original_dns"; then
        restore_failed=true
        continue
    fi
    rm -f "$state_file"
done

# Migrate state written by releases that kept a single cache next to the script.
if [ -f "$legacy_state_file" ]; then
    nic=$(route -n get default 2>/dev/null | awk '/interface/{print $2; exit}')
    network_service=$(network_service_for_device "$nic")
    original_dns=$(cat "$legacy_state_file")
    if [ -z "$network_service" ] || ! restore_dns "$network_service" "$original_dns"; then
        restore_failed=true
    else
        rm -f "$legacy_state_file"
    fi
fi

rmdir "$state_dir" 2>/dev/null || true

if [ "$restore_failed" = true ]; then
    exit 1
fi
