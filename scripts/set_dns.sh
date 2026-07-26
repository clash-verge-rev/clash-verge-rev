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
# 从网络服务列表中获取硬件端口
hardware_port=$(networksetup -listnetworkserviceorder | awk -v dev="$nic" '
    /^\([0-9]+\) /{port=$0; sub(/^\([0-9]+\) /, "", port)} 
    /\(Hardware Port:/{interface=$NF;sub(/\)/, "", interface); if (interface == dev) {print port; exit}}
')

# 获取当前DNS设置
original_dns=$(networksetup -getdnsservers "$hardware_port")

# 判断当前DNS是否已经等于目标DNS（即我们此前设置的值）。
# 这种情况常见于 macOS 唤醒后的重复校正：此时绝不能把我们自己写入的值
# 当作“原始DNS”存回 .original_dns.txt，否则会永久丢失用户真实的DNS配置。
current_is_target=false
current_dns_oneline=$(echo "$original_dns" | tr '\n' ' ' | tr -s '[:space:]' ' ' | sed 's/^ *//;s/ *$//')
if [ "$current_dns_oneline" = "$1" ]; then
    current_is_target=true
fi

# 检查当前DNS设置是否有效
is_valid_dns=false
for ip in $original_dns; do
    ip=$(echo "$ip" | tr -d '[:space:]')
    if [ -n "$ip" ] && (is_valid_ipv4 "$ip" || is_valid_ipv6 "$ip"); then
        is_valid_dns=true
        break
    fi
done

# 更新原始DNS备份：仅当当前DNS不是我们的目标值时才写入，
# 避免覆盖睡眠前保存的真实DNS状态（见 issue #7593）。
if [ "$current_is_target" = false ]; then
    if [ "$is_valid_dns" = false ]; then
        echo "empty" >.original_dns.txt
    else
        echo "$original_dns" >.original_dns.txt
    fi
fi
networksetup -setdnsservers "$hardware_port" "$1"
