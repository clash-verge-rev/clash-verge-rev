#!/bin/bash
[ $# -lt 1 ] && echo "Usage: $0 <placeholder IP address>" && exit 1

# Prints one value of a SystemConfiguration dictionary, or nothing when the key is absent.
function sc_value() {
    printf 'show %s\nquit\n' "$1" | scutil | sed -n "s/^ *$2 : //p"
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

result=0
# Older releases kept a single backup for whichever service was primary.
if [ -f .original_dns.txt ]; then
    service_id=$(sc_value State:/Network/Global/IPv4 PrimaryService)
    if [ -z "$service_id" ] || ! mkdir -p .original_dns; then
        result=1
    elif [ -f ".original_dns/$service_id" ]; then
        rm -f .original_dns.txt || result=1
    elif ! mv .original_dns.txt ".original_dns/$service_id"; then
        result=1
    fi
fi

for backup in .original_dns/*; do
    [ -f "$backup" ] || continue
    hardware_port=$(sc_value "Setup:/Network/Service/${backup##*/}" UserDefinedName)
    # Kept for a service that is gone: there is nothing to write it back to.
    [ -n "$hardware_port" ] || continue
    if ! current_dns=$(dns_of "$hardware_port"); then
        echo "Cannot read DNS servers of $hardware_port." >&2
        result=1
        continue
    fi
    # A service no longer on the placeholder was changed by someone else, and that change stands.
    if [ "$current_dns" = "$1" ]; then
        original_dns=$(cat "$backup") || { result=1; continue; }
        # Older releases could back up the placeholder itself.
        [ "$original_dns" = "$1" ] && original_dns=empty
        networksetup -setdnsservers "$hardware_port" $original_dns
        if [ "$(dns_of "$hardware_port")" != "$original_dns" ]; then
            echo "Failed to restore DNS for $hardware_port." >&2
            result=1
            continue
        fi
    fi
    rm -f "$backup" || result=1
done
rmdir .original_dns 2>/dev/null
exit $result
