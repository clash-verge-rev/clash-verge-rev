nic=$(route -n get default | grep "interface" | awk '{print $2}')

hardware_port=$(networksetup -listallhardwareports | awk -v dev="$nic" '/Hardware Port/{port=$3} /Device:/{if ($2 == dev) {print port; exit}}')

original_dns=$(networksetup -getdnsservers $hardware_port)

if [ ${#original_dns} -gt 15 ]
then
    echo "Empty" > original_dns.txt
else
    echo $original_dns > original_dns.txt
fi

networksetup -setdnsservers $hardware_port 223.5.5.5
