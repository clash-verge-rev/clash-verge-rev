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

[ $# -lt 1 ] && echo "Usage: $0 <IP address>" && exit 1
! is_valid_ip "$1" && echo "$1 is not a valid IP address." && exit 1

nic=$(route -n get default | grep "interface" | awk '{print $2}')
hardware_port=$(networksetup -listnetworkserviceorder | awk -v dev="$nic" '
    /^\([0-9]+\) /{port=$0; sub(/^\([0-9]+\) /, "", port)} 
    /\(Hardware Port:/{interface=$NF;sub(/\)/, "", interface); if (interface == dev) {print port; exit}}
')

original_dns=$(networksetup -getdnsservers "$hardware_port")

is_valid_dns=false
for ip in $original_dns; do
    ip=$(echo "$ip" | tr -d '[:space:]')
    if [ -n "$ip" ] && (is_valid_ipv4 "$ip" || is_valid_ipv6 "$ip"); then
        is_valid_dns=true
        break
    fi
done

if [ "$is_valid_dns" = false ]; then
    echo "empty" >.original_dns.txt
else
    echo "$original_dns" >.original_dns.txt
fi
networksetup -setdnsservers "$hardware_port" "$1"
