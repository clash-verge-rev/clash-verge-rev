nic=$(route -n get default | grep "interface" | awk '{print $2}')

hardware_port=$(networksetup -listallhardwareports | awk -v dev="$nic" '/Hardware Port/{port=$3} /Device:/{if ($2 == dev) {print port; exit}}')

if [ -f original_dns.txt ]; then
    original_dns=$(cat original_dns.txt)
else
    original_dns=$(networksetup -getdnsservers $hardware_port)
fi

networksetup -setdnsservers $hardware_port $original_dns
