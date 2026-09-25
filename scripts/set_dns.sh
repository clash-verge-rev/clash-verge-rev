#!/bin/bash

function is_valid_ipv4() {
    local ip=$1
    local IFS='.'
    local -a octets

    [[ ! $ip =~ ^([0-9]+\.){3}[0-9]+$ ]] && return 1
    read -r -a octets <<<"$ip"
    [ "${#octets[@]}" -ne 4 ] && return 1

    for octet in "${octets[@]}"; do
        if ! [[ "$octet" =~ ^[0-9]+$ ]] || ((10#$octet > 255)); then
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

# Network service UUIDs survive service renames and route changes.
set -euo pipefail
umask 077
state=.dns-state

service_value() {
    printf 'show Setup:/Network/Service/%s\nquit\n' "$1" | scutil |
        sed -n "s/^ *$2 : //p"
}

service_id() {
    local id name device
    for id in $(printf 'list Setup:/Network/Service/[^/]+$\nquit\n' | scutil | sed -n 's|.*Setup:/Network/Service/||p'); do
        name=$(service_value "$id" UserDefinedName)
        device=$(service_value "$id/Interface" DeviceName)
        if [[ "$name" == "$1" && "$device" == "$2" ]]; then
            printf '%s\n' "$id"
            return
        fi
    done
    return 1
}

read_dns() {
    local output ip
    output=$(networksetup -getdnsservers "$1") || return 1
    if [[ "$output" == "There aren't any DNS Servers set on "* ]]; then
        printf '%s\n' empty
        return
    fi
    [[ -n "$output" ]] || return 1
    for ip in $output; do
        is_valid_ip "$ip" || return 1
    done
    printf '%s\n' "$output"
}

restore_record() {
    local file=$1 id service device applied current original
    id=$(sed -n '1p' "$file")
    service=$(service_value "$id" UserDefinedName)
    device=$(sed -n '2p' "$file")
    applied=$(sed -n '3p' "$file")
    original=$(sed -n '4,$p' "$file")
    [[ -n "$service" && -n "$device" && -n "$original" ]] || return 1
    [[ "$(service_value "$id/Interface" DeviceName)" == "$device" ]] || return 1
    current=$(read_dns "$service") || return 1
    if [[ "$current" == "$original" ]]; then
        rm "$file"
        return
    fi
    # A user's intervening edit supersedes our ownership of the DNS setting.
    if [[ "$current" != "$applied" ]]; then
        echo "DNS changed externally for $service; retaining backup" >&2
        return 1
    fi
    local -a servers
    read -r -a servers <<< "$(printf '%s' "$original" | tr '\n' ' ')"
    networksetup -setdnsservers "$service" "${servers[@]}" || return 1
    [[ "$(read_dns "$service")" == "$original" ]] || return 1
    rm "$file"
}

[[ ! -f .original_dns.txt ]] || { echo 'Legacy DNS backup has no service identity' >&2; exit 1; }
if [[ "${1:-}" == --restore ]]; then
    result=0
    for record in "$state"/*.dns; do
        [[ -f "$record" ]] || continue
        restore_record "$record" || result=1
    done
    exit "$result"
fi

[[ $# == 1 ]] && is_valid_ip "$1" || { echo 'Expected a DNS IP address' >&2; exit 1; }
nic=$(route -n get default | awk '/interface:/ {print $2; exit}')
[[ -n "$nic" ]] || exit 1
service=$(networksetup -listnetworkserviceorder | awk -v dev="$nic" '
    /^\([0-9]+\) / {service=$0; sub(/^\([0-9]+\) /, "", service)}
    /\(Hardware Port:/ {device=$NF; sub(/\)/, "", device); if (device == dev) {print service; exit}}')
[[ -n "$service" ]] || exit 1
mkdir -p "$state"
id=$(service_id "$service" "$nic")
record="$state/$id.dns"
current=$(read_dns "$service")
if [[ -f "$record" ]]; then
    applied=$(sed -n '3p' "$record")
    original=$(sed -n '4,$p' "$record")
    [[ "$current" == "$applied" || "$current" == "$original" ]] || {
        echo "DNS changed externally for $service; retaining backup" >&2; exit 1;
    }
else
    original=$current
fi
# Persist recovery data before changing the system, including on partial failure.
temporary=$(mktemp "$state/.pending.XXXXXX")
trap 'rm -f "$temporary"' EXIT
printf '%s\n%s\n%s\n%s\n' "$id" "$nic" "$1" "$original" > "$temporary"
mv "$temporary" "$record"
networksetup -setdnsservers "$service" "$1"
[[ "$(read_dns "$service")" == "$1" ]]
