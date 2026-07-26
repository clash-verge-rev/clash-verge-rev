#!/bin/bash

# Validate an IPv4 address.
function is_valid_ipv4() {
    local ip=$1
    local IFS='.'
    local -a octets

    [[ ! $ip =~ ^([0-9]+\.){3}[0-9]+$ ]] && return 1
    read -r -a octets <<<"$ip"
    [ "${#octets[@]}" -ne 4 ] && return 1

    for octet in "${octets[@]}"; do
        if ! [[ "$octet" =~ ^[0-9]+$ ]] || ((octet < 0 || octet > 255)); then
            return 1
        fi
    done
    return 0
}

# Validate an IPv6 address.
function is_valid_ipv6() {
    local ip=$1
    if [[ ! $ip =~ ^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$ ]] &&
        [[ ! $ip =~ ^(([0-9a-fA-F]{0,4}:){0,7}:|(:[0-9a-fA-F]{0,4}:){0,6}:[0-9a-fA-F]{0,4})$ ]]; then
        return 1
    fi
    return 0
}

# Validate an IP address as IPv4 or IPv6.
function is_valid_ip() {
    is_valid_ipv4 "$1" || is_valid_ipv6 "$1"
}

# Resolve the network service name for a given device (e.g. en0).
function network_service_for_device() {
    local device=$1
    networksetup -listnetworkserviceorder | awk -v dev="$device" '
        /^\([0-9]+\) /{service=$0; sub(/^\([0-9]+\) /, "", service)}
        /\(Hardware Port:/{interface=$NF; sub(/\)/, "", interface); if (interface == dev) {print service; exit}}
    '
}

if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <IP address> <state directory>"
    exit 1
fi

dns_server=$1
state_dir=$2

if ! is_valid_ip "$dns_server"; then
    echo "$dns_server is not a valid IP address."
    exit 1
fi

nic=$(route -n get default 2>/dev/null | awk '/interface/{print $2; exit}')
if [[ ! $nic =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Unable to determine a safe default network interface."
    exit 1
fi

network_service=$(network_service_for_device "$nic")
if [ -z "$network_service" ]; then
    echo "Unable to determine the default network service."
    exit 1
fi

umask 077
if ! mkdir -p "$state_dir"; then
    echo "Unable to create DNS state directory."
    exit 1
fi

# Each network service owns its own state file so that switching the default
# service (e.g. Wi-Fi -> Ethernet) across a sleep/wake never clobbers the state
# saved for the previous service.
service_id=$(printf '%s' "$network_service" | LC_ALL=C LANG=C shasum -a 256 | awk '{print $1}')
if [[ ! $service_id =~ ^[0-9a-f]{64}$ ]]; then
    echo "Unable to identify the default network service."
    exit 1
fi

state_file="$state_dir/$nic-$service_id.state"
if [ ! -f "$state_file" ]; then
    if ! original_dns=$(networksetup -getdnsservers "$network_service"); then
        echo "Unable to read the original DNS servers."
        exit 1
    fi

    saved_dns="empty"
    for ip in $original_dns; do
        ip=$(echo "$ip" | tr -d '[:space:]')
        if [ -n "$ip" ] && is_valid_ip "$ip"; then
            saved_dns=$original_dns
            break
        fi
    done

    # Write the original DNS state atomically: a temp file is filled first and
    # then moved into place. Only after a successful move do we touch the live
    # system DNS, so a crash can never leave us without a usable backup.
    temporary_state="$state_file.tmp.$$"
    if ! {
        printf '%s\n' "$network_service"
        printf '%s\n' "$saved_dns"
    } >"$temporary_state"; then
        rm -f "$temporary_state"
        echo "Unable to save the original DNS state."
        exit 1
    fi
    if ! mv "$temporary_state" "$state_file"; then
        rm -f "$temporary_state"
        echo "Unable to install the original DNS state."
        exit 1
    fi
fi

networksetup -setdnsservers "$network_service" "$dns_server"
