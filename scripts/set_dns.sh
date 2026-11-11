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

# Prints one value of a SystemConfiguration dictionary, or nothing when the key is absent.
function sc_value() {
    local dictionary
    dictionary=$(printf 'show %s\nquit\n' "$1" | scutil) || return 1
    sed -n "s/^ *$2 : //p" <<<"$dictionary"
}

# Prints the service's DNS servers, or "empty" when none is set; fails on any other answer.
function dns_of() {
    local dns line ip='^[0-9A-Fa-f]*[.:][0-9A-Fa-f.:]*(%[[:alnum:]_.-]+)?$'
    dns=$(networksetup -getdnsservers "$1") || return 1
    if [ "$dns" = "There aren't any DNS Servers set on $1." ]; then
        echo "empty"
        return
    fi
    [ -n "$dns" ] || return 1
    while read -r line; do
        [[ $line =~ $ip ]] || return 1
    done <<<"$dns"
    echo "$dns"
}

[ $# -lt 1 ] && echo "Usage: $0 <newline-separated DNS servers> [legacy state directory]" >&2 && exit 1
dns_servers=()
while read -r server; do
    ! is_valid_ip "$server" && echo "$server is not a valid IP address." >&2 && exit 1
    dns_servers+=("$server")
done <<<"$1"

# Backups are keyed by service ID, which survives renaming the service and renumbering its interface.
service_id=$(sc_value State:/Network/Global/IPv4 PrimaryService) || exit 1
hardware_port=$(sc_value "Setup:/Network/Service/$service_id" UserDefinedName) || exit 1
[ -z "$hardware_port" ] && echo "No primary network service; waiting for the network." >&2 && exit 75

original_dns=$(dns_of "$hardware_port") || { echo "Cannot read DNS servers of $hardware_port." >&2; exit 1; }

backup=".original_dns/$service_id"
mkdir -p .original_dns || exit 1
# Key old single-slot backups before import so a later network switch cannot reassign them.
for state_dir in "$PWD" "${2:-$PWD}"; do
    if [ -f "$state_dir/.original_dns.txt" ]; then
        mkdir -p "$state_dir/.original_dns" || exit 1
        if [ -f "$state_dir/.original_dns/$service_id" ]; then
            rm -f "$state_dir/.original_dns.txt" || exit 1
        else
            mv "$state_dir/.original_dns.txt" "$state_dir/.original_dns/$service_id" || exit 1
        fi
    fi
done
if [ ! -f "$backup" ] && [ -n "$2" ] && [ -f "$2/$backup" ]; then
    cp "$2/$backup" ".original_dns/.$service_id" || exit 1
    mv ".original_dns/.$service_id" "$backup" || exit 1
fi
backup_header='# clash-verge-dns-managed'
function save_backup() {
    printf '%s\n%s\n' "$backup_header" "$1" >".original_dns/.$service_id" &&
        mv ".original_dns/.$service_id" "$backup"
}

saved_dns=
legacy_backup=false
if [ -f "$backup" ]; then
    saved_dns=$(cat "$backup") || exit 1
    case "$saved_dns" in
        "$backup_header"$'\n'*) saved_dns=${saved_dns#*$'\n'} ;;
        *) legacy_backup=true ;;
    esac
fi
if [ "$original_dns" != "$1" ]; then
    # Only an unmarked historical backup owns the old single-address placeholder.
    if [ "$original_dns" != "114.114.114.114" ] || [ "$legacy_backup" != true ]; then
        save_backup "$original_dns" || exit 1
        legacy_backup=false
    fi
    networksetup -setdnsservers "$hardware_port" "${dns_servers[@]}"
    [ "$(dns_of "$hardware_port")" = "$1" ] || { echo "Failed to set DNS for $hardware_port." >&2; exit 1; }
fi
# Keep legacy ownership until the new list is verified, including a retry after a failed marker write.
if [ "$legacy_backup" = true ]; then
    save_backup "$saved_dns" || exit 1
fi
