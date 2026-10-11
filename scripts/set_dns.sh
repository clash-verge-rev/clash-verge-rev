#!/bin/bash

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

function is_valid_ipv6() {
    local ip=$1
    if [[ ! $ip =~ ^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$ ]] &&
        [[ ! $ip =~ ^(([0-9a-fA-F]{0,4}:){0,7}:|(:[0-9a-fA-F]{0,4}:){0,6}:[0-9a-fA-F]{0,4})$ ]]; then
        return 1
    fi
    return 0
}

function is_valid_ip() {
    is_valid_ipv4 "$1" || is_valid_ipv6 "$1"
}

# Prints one value of a SystemConfiguration dictionary, or nothing when the key is absent.
function sc_value() {
    printf 'show %s\nquit\n' "$1" | scutil | sed -n "s/^ *$2 : //p"
}

# Prints the service's DNS servers, or "empty" when none is set; fails on any other answer.
function dns_of() {
    local dns line ip='^[0-9A-Fa-f]*[.:][0-9A-Fa-f.:]*(%[[:alnum:]_.-]+)?$'
    dns=$(networksetup -getdnsservers "$1") || return 1
    if [ "$dns" = "There aren't any DNS Servers set on $1." ]; then
        echo "empty"
        return
    fi
    [ -n "$dns" ] || return 1
    while read -r line; do
        [[ $line =~ $ip ]] || return 1
    done <<<"$dns"
    echo "$dns"
}

[ $# -lt 1 ] && echo "Usage: $0 <IP address>" && exit 1
! is_valid_ip "$1" && echo "$1 is not a valid IP address." && exit 1

# Backups are keyed by service ID, which survives renaming the service and renumbering its interface.
service_id=$(sc_value State:/Network/Global/IPv4 PrimaryService)
hardware_port=$(sc_value "Setup:/Network/Service/$service_id" UserDefinedName)
[ -z "$hardware_port" ] && echo "No primary network service." && exit 1

original_dns=$(dns_of "$hardware_port") || { echo "Cannot read DNS servers of $hardware_port." >&2; exit 1; }

backup=".original_dns/$service_id"
mkdir -p .original_dns || exit 1
# Older releases kept a single backup for whichever service was primary.
if [ -f .original_dns.txt ]; then
    if [ -f "$backup" ]; then
        rm -f .original_dns.txt || exit 1
    else
        mv .original_dns.txt "$backup" || exit 1
    fi
fi
# The placeholder is ours, not the user's: keep the backup taken before it was applied.
if [ "$original_dns" != "$1" ]; then
    echo "$original_dns" >"$backup" || exit 1
    networksetup -setdnsservers "$hardware_port" "$1"
    [ "$(dns_of "$hardware_port")" = "$1" ] || { echo "Failed to set DNS for $hardware_port." >&2; exit 1; }
elif [ ! -f "$backup" ]; then
    echo "empty" >"$backup" || exit 1
fi
