#!/bin/bash
[ $# -lt 1 ] && echo "Usage: $0 <newline-separated DNS servers> [legacy state directory]" >&2 && exit 1

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

backup_header='# clash-verge-dns-managed'
completed_backups=()

function restore_dns() {
    local result=0
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
        # Current backups take precedence even after their DNS has already been restored.
        if [ "$PWD" != "$state_dir" ] && [ -f "$state_dir/$backup" ]; then
            completed_backups+=("$PWD/$backup")
            continue
        fi
        hardware_port=$(sc_value "Setup:/Network/Service/${backup##*/}" UserDefinedName) || { result=1; continue; }
        # Kept for a service that is gone: there is nothing to write it back to.
        [ -n "$hardware_port" ] || continue
        if ! current_dns=$(dns_of "$hardware_port"); then
            echo "Cannot read DNS servers of $hardware_port." >&2
            result=1
            continue
        fi
        original_dns=$(cat "$backup") || { result=1; continue; }
        legacy_backup=false
        case "$original_dns" in
            "$backup_header"$'\n'*) original_dns=${original_dns#*$'\n'} ;;
            *) legacy_backup=true ;;
        esac
        # A service no longer on its recorded placeholder was changed by someone else.
        if [ "$current_dns" = "$1" ] || { [ "$legacy_backup" = true ] && [ "$current_dns" = "114.114.114.114" ]; }; then
            networksetup -setdnsservers "$hardware_port" $original_dns
            if [ "$(dns_of "$hardware_port")" != "$original_dns" ]; then
                echo "Failed to restore DNS for $hardware_port." >&2
                result=1
                continue
            fi
        fi
        completed_backups+=("$PWD/$backup")
    done
    return $result
}

result=0
state_dir=$PWD
restore_dns "$1" || result=1
if [ -n "$2" ] && [ "$2" != "$PWD" ]; then
    { cd "$2" && restore_dns "$1"; } || result=1
fi
# Remove superseded legacy backups first; a cleanup failure must leave current authority intact.
if [ "$result" -eq 0 ]; then
    for ((index=${#completed_backups[@]}-1; index>=0; index--)); do
        rm -f "${completed_backups[index]}" || { result=1; break; }
    done
fi
rmdir "$state_dir/.original_dns" "${2:-$state_dir}/.original_dns" 2>/dev/null
exit $result
