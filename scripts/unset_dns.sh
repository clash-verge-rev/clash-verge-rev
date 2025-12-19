#!/bin/bash
nic=$(route -n get default | grep "interface" | awk '{print $2}')

hardware_port=$(networksetup -listnetworkserviceorder | awk -v dev="$nic" '
    /^\([0-9]+\) /{port=$0; sub(/^\([0-9]+\) /, "", port)} 
    /\(Hardware Port:/{interface=$NF;sub(/\)/, "", interface); if (interface == dev) {print port; exit}}
')

if [ -f .original_dns.txt ]; then
    original_dns=$(cat .original_dns.txt)
    networksetup -setdnsservers "$hardware_port" $original_dns
    rm -rf .original_dns.txt
fi
