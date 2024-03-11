nic=$(route -n get default | grep "interface" | awk '{print $2}')

hardware_port=$(networksetup -listallhardwareports | awk -v dev="$nic" '/Hardware Port/{port=$3} /Device:/{if ($2 == dev) {print port; exit}}')

networksetup -setdnsservers $hardware_port 192.18.0.2