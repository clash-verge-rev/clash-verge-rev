#!/bin/bash

function is_valid_ip() {
    local ip=$1
    local IFS='.'
    local -a octets

    if [[ ! $ip =~ ^([0-9]+\.){3}[0-9]+$ ]]; then
        return 1
    fi

    read -r -a octets <<<"$ip"

    if [ "${#octets[@]}" -ne 4 ]; then
        return 1
    fi

    for octet in "${octets[@]}"; do
        if ! [[ "$octet" =~ ^[0-9]+$ ]] || ((octet < 0 || octet > 255)); then
            return 1
        fi
    done

    return 0
}

if [ $# -lt 1 ]; then
    echo "Usage: $0 <hardware_port>"
    exit 1
fi

if ! is_valid_ip "$1"; then
    echo "$1 is not a valid IP address."
    exit 1
fi

nic=$(route -n get default | grep "interface" | awk '{print $2}')
hardware_port=$(networksetup -listallhardwareports | awk -v dev="$nic" '
    /Hardware Port:/{
        port=$0; gsub("Hardware Port: ", "", port)
    } 
    /Device: /{
        if ($2 == dev) {
            print port; 
            exit
        }
    }
')

original_dns=$(networksetup -getdnsservers "$hardware_port")

if [ ${#original_dns} -le 15 ]; then
    if [ -n "$original_dns" ]; then
        echo $original_dns >original_dns.txt
        networksetup -setdnsservers "$hardware_port" "$1"
    fi
fi
