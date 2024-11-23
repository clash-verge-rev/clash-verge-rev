#!/bin/bash
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

if [ -f .original_dns.txt ]; then
    original_dns=$(cat .original_dns.txt)
    networksetup -setdnsservers "$hardware_port" $original_dns
    rm -rf .original_dns.txt
fi
