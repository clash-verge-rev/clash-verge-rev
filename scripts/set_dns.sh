#!/bin/bash

# 验证IPv4地址格式
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

# 验证IPv6地址格式
function is_valid_ipv6() {
    local ip=$1
    if [[ ! $ip =~ ^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$ ]] &&
        [[ ! $ip =~ ^(([0-9a-fA-F]{0,4}:){0,7}:|(:[0-9a-fA-F]{0,4}:){0,6}:[0-9a-fA-F]{0,4})$ ]]; then
        return 1
    fi
    return 0
}

# 验证IP地址是否为有效的IPv4或IPv6
function is_valid_ip() {
    is_valid_ipv4 "$1" || is_valid_ipv6 "$1"
}

# 检查参数
[ $# -lt 1 ] && echo "Usage: $0 <IP address>" && exit 1
! is_valid_ip "$1" && echo "$1 is not a valid IP address." && exit 1

# 获取网络接口和硬件端口
nic=$(route -n get default | grep "interface" | awk '{print $2}')
hardware_port=$(networksetup -listallhardwareports | awk -v dev="$nic" '
    /Hardware Port:/{port=$0; gsub("Hardware Port: ", "", port)} 
    /Device: /{if ($2 == dev) {print port; exit}}
')

# 获取当前DNS设置
original_dns=$(networksetup -getdnsservers "$hardware_port")

# 检查当前DNS设置是否有效
is_valid_dns=false
for ip in $original_dns; do
    ip=$(echo "$ip" | tr -d '[:space:]')
    if [ -n "$ip" ] && (is_valid_ipv4 "$ip" || is_valid_ipv6 "$ip"); then
        is_valid_dns=true
        break
    fi
done

# 更新DNS设置
if [ "$is_valid_dns" = false ]; then
    echo "empty" >.original_dns.txt
else
    echo "$original_dns" >.original_dns.txt
fi
networksetup -setdnsservers "$hardware_port" "$1"
