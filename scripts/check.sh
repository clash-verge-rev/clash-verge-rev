#!/bin/bash

VER='1.0.0'

UA_BROWSER="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
UA_SEC_CH_UA='"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
UA_ANDROID="Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"

color_print() {
    Font_Black="\033[30m"
    Font_Red="\033[31m"
    Font_Green="\033[32m"
    Font_Yellow="\033[33m"
    Font_Blue="\033[34m"
    Font_Purple="\033[35m"
    Font_SkyBlue="\033[36m"
    Font_White="\033[37m"
    Font_Suffix="\033[0m"
}

command_exists() {
    command -v "$1" > /dev/null 2>&1
}

gen_uuid() {
    if [ -f /proc/sys/kernel/random/uuid ]; then
        local genuuid=$(cat /proc/sys/kernel/random/uuid)
        echo "${genuuid}"
        return 0
    fi

    if command_exists uuidgen; then
        local genuuid=$(uuidgen)
        echo "${genuuid}"
        return 0
    fi

    if command_exists powershell && [ "$OS_WINDOWS" == 1 ]; then
        local genuuid=$(powershell -c "[guid]::NewGuid().ToString()")
        echo "${genuuid}"
        return 0
    fi

    return 1
}

gen_random_str() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Length missing.${Font_Suffix}"
        exit 1
    fi
    local randomstr=$(< /dev/urandom tr -dc A-Za-z0-9 | head -c "$1")
    echo "${randomstr}"
}

resolve_ip_address() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Domain missing.${Font_Suffix}"
        exit 1
    fi
    if [ -z "$2" ]; then
        echo -e "${Font_Red}DNS Record type missing.${Font_Suffix}"
        exit 1
    fi

    local domain="$1"
    local recordType="$2"

    if command_exists nslookup && [ "$OS_WINDOWS" != 1 ]; then
        local nslookupExists=1
    fi
    if command_exists dig; then
        local digExists=1
    fi
    if [ "$OS_IOS" == 1 ]; then
        local nslookupExists=0
        local digExists=0
    fi

    if [ "$nslookupExists" == 1 ]; then
        if [ "$recordType" == 'AAAA' ]; then
            local result=$(nslookup -q=AAAA "${domain}" | grep -woP "Address: \K[\d:a-f]+")
            echo "${result}"
            return
        else
            local result=$(nslookup -q=A "${domain}" | grep -woP "Address: \K[\d.]+")
            echo "${result}"
            return
        fi
    fi
    if [ "$digExists" == 1 ]; then
        if [ "$recordType" == 'AAAA' ]; then
            local result=$(dig +short "${domain}" AAAA)
            echo "${result}"
            return
        else
            local result=$(dig +short "${domain}" A)
            echo "${result}"
            return
        fi
    fi

    if [ "$recordType" == 'AAAA' ]; then
        local pingArgs='-6 -c 1 -w 1 -W 1'
        [ "$OS_ANDROID" == 1 ] && pingArgs='-c 1 -w 1 -W 1'
        local result=$(ping6 ${pingArgs} "${domain}" 2>/dev/null | head -n 1 | grep -woP '\s\(\K[\d:a-f]+')
        echo "${result}"
        return
    else
        local pingArgs='-4 -c 1 -w 1 -W 1'
        [ "$OS_ANDROID" == 1 ] && pingArgs='-c 1 -w 1 -W 1'
        local result=$(ping ${pingArgs} "${domain}" 2>/dev/null | head -n 1 | grep -woP '\s\(\K[\d.]+')
        echo "${result}"
        return
    fi
}

validate_proxy() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Param Proxy Address is missing.${Font_Suffix}"
        exit 1
    fi

    local tmpresult=$(echo "$1" | grep -P '^(socks|socks4|socks5|http)://([^:]+:[^@]+@)?(([0-9]{1,3}\.){3}[0-9]{1,3}|(\[[0-9a-fA-F:]+\]|([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|((([0-9a-fA-F]{1,4}:){1,6})|::(([0-9a-fA-F]{1,4}:){1,6}))([0-9a-fA-F]{1,4}))):(0|[1-9][0-9]{0,4})$')
    if [ -z "$tmpresult" ]; then
        echo -e "${Font_Red}Proxy IP invalid.${Font_Suffix}"
        exit 1
    fi

    local port=$(echo "$1" | grep -woP ':\K[0-9]+$')
    if [ "$port" -ge 65535 ]; then
        echo -e "${Font_Red}Proxy Port invalid.${Font_Suffix}"
        exit 1
    fi
}

validate_ip_address() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Param IP Address is missing.${Font_Suffix}"
        exit 1
    fi

    if echo "$1" | awk '{$1=$1; print}' | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
        return 4
    fi
    echo "$1" | awk '{$1=$1; print}' | grep -Eq '^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(([0-9a-fA-F]{1,4}:){1,7}|:):([0-9a-fA-F]{1,4}:){1,7}|:$|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}$|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}$|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}$|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}$|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}$|([0-9a-fA-F]{1,4}:){1}(:[0-9a-fA-F]{1,4}){1,6}$|:(:[0-9a-fA-F]{1,4}){1,7}$|((([0-9a-fA-F]{1,4}:){1,4}:|:):(([0-9a-fA-F]{1,4}:){0,1}[0-9a-fA-F]{1,4}){1,4})$'
    if [ "$?" == 0 ]; then
        return 6
    fi

    return 1
}

validate_intranet() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Param missing.${Font_Suffix}"
    fi
    # See https://en.wikipedia.org/wiki/Reserved_IP_addresses
    local tmpresult=$(echo "$1" | grep -E '(^|\s)(10\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|172\.(1[6-9]|2[0-9]|3[01])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|192\.168\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|100\.([6-9][4-9]|1[0-2][0-7])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|169\.254\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|192\.88\.99\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|192\.0\.(0|2)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|198\.(1[89])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|198\.51\.100\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|203\.0\.113\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|2[23][4-9]\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|233\.252\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])|(24[0-9]|25[0-5])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|[01]?[0-9]?[0-9]))(\s|$)')
    if [ -z "$tmpresult" ]; then
        return 1
    fi

    return 0
}

validate_region_id() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Param missing.${Font_Suffix}"
        exit 1
    fi
    local regionid="$1"
    local result=$(echo "$regionid" | grep -E '^[0-9]$|^1[0-1]$|^99$|^88$|^66$')
    if [ -z "$result" ]; then
        return 1
    fi
    return 0
}

validate_net_type() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Param missing.${Font_Suffix}"
        exit 1
    fi
    local netType="$1"
    local result=$(echo "$netType" | grep -E '^4$|^6$|^0$')
    if [ -z "$result" ]; then
        echo -e "${Font_Red}Invalid Network Type.${Font_Suffix}"
        exit 1
    fi
    return 0
}

check_proxy_connectivity() {
    local result1=$(curl $USE_NIC $USE_PROXY -s 'https://ip.sb' --user-agent "${UA_BROWSER}" )
    local result2=$(curl $USE_NIC $USE_PROXY -s 'https://1.0.0.1/cdn-cgi/trace' --user-agent "${UA_BROWSER}")
    if [ -n "$result1" ] && [ -n "$result2" ]; then
        return 0
    fi

    return 1
}

check_net_connctivity() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Param missing.${Font_Suffix}"
        exit 1
    fi

    if [ "$1" == 4 ]; then
        local result1=$(curl -4 ${CURL_OPTS} -fs 'http://www.msftconnecttest.com/connecttest.txt' -w '%{http_code}' -o /dev/null --user-agent "${UA_BROWSER}")
        if [ "$result1" == '200' ]; then
            return 0
        fi
    fi

    if [ "$1" == 6 ]; then
        local result2=$(curl -6 ${CURL_OPTS} -fs 'http://ipv6.msftconnecttest.com/connecttest.txt' -w '%{http_code}' -o /dev/null --user-agent "${UA_BROWSER}")
        if [ "$result2" == '200' ]; then
            return 0
        fi
    fi

    return 1
}

check_os_type() {
    OS_TYPE=''
    local ifLinux=$(uname -a | grep -i 'linux')
    local ifFreeBSD=$(uname -a | grep -i 'freebsd')
    local ifTermux=$(echo "$PWD" | grep -i 'termux')
    local ifMacOS=$(uname -a | grep -i 'Darwin')
    local ifMinGW=$(uname -a | grep -i 'MINGW')
    local ifCygwin=$(uname -a | grep -i 'CYGWIN')
    local ifAndroid=$(uname -a | grep -i 'android')
    local ifiSh=$(uname -a | grep -i '\-ish')

    if [ -n "$ifLinux" ] && [ -z "$ifAndroid" ] && [ -z "$ifiSh" ]; then
        OS_TYPE='linux'
        OS_LINUX=1
        return
    fi
    if [ -n "$ifTermux" ]; then
        OS_TYPE='termux'
        OS_TERMUX=1
        OS_ANDROID=1
        return
    fi
    if [ -n "$ifMacOS" ]; then
        OS_TYPE='macos'
        OS_MACOS=1
        return
    fi
    if [ -n "$ifMinGW" ]; then
        OS_TYPE='msys'
        OS_WINDOWS=1
        return
    fi
    if [ -n "$ifCygwin" ]; then
        OS_TYPE='cygwin'
        OS_WINDOWS=1
        return
    fi
    if [ -n "$ifFreeBSD" ]; then
        OS_TYPE='freebsd'
        OS_FREEBSD=1
        return
    fi
    if [ -n "$ifAndroid" ]; then
        OS_TYPE='android'
        OS_ANDROID=1
        return
    fi
    if [ -n "$ifiSh" ]; then
        OS_TYPE='ish'
        OS_IOS=1
        return
    fi

    echo -e "${Font_Red}Unsupported OS Type.${Font_Suffix}"
    exit 1
}

check_dependencies() {
    CURL_SSL_CIPHERS_OPT=''

    if [ "$OS_TYPE" == 'linux' ]; then
        source /etc/os-release
        if [ -z "$ID" ]; then
            echo -e "${Font_Red}Unsupported Linux OS Type.${Font_Suffix}"
            exit 1
        fi

        case "$ID" in
        debian|devuan|kali)
            OS_NAME='debian'
            PKGMGR='apt'
            ;;
        ubuntu)
            OS_NAME='ubuntu'
            PKGMGR='apt'
            ;;
        centos|fedora|rhel|almalinux|rocky|amzn)
            OS_NAME='rhel'
            PKGMGR='dnf'
            ;;
        arch|archarm)
            OS_NAME='arch'
            PKGMGR='pacman'
            ;;
        alpine)
            OS_NAME='alpine'
            PKGMGR='apk'
            ;;
        *)
            OS_NAME="$ID"
            PKGMGR='apt'
            ;;
        esac
    fi

    if [ -z $(echo 'e' | grep -P 'e' 2>/dev/null) ]; then
        echo -e "${Font_Red}command 'grep' function is incomplete, please install the full version first.${Font_Suffix}"
        exit 1
    fi

    if ! command_exists curl; then
        echo -e "${Font_Red}command 'curl' is missing, please install it first.${Font_Suffix}"
        exit 1
    fi

    if ! gen_uuid >/dev/null; then
        echo -e "${Font_Red}command 'uuidgen' is missing, please install it first.${Font_Suffix}"
        exit 1
    fi

    if ! command_exists openssl; then
        echo -e "${Font_Red}command 'openssl' is missing, please install it first.${Font_Suffix}"
        exit 1
    fi

    if [ "$OS_MACOS" == 1 ]; then
        if ! command_exists md5sum; then
            echo -e "${Font_Red}command 'md5sum' is missing, please install it first.${Font_Suffix}"
            exit 1
        fi
        if ! command_exists sha256sum; then
            echo -e "${Font_Red}command 'sha256sum' is missing, please install it first.${Font_Suffix}"
            exit 1
        fi
    fi

    if [ "$OS_NAME" == 'debian' ] || [ "$OS_NAME" == 'ubuntu' ]; then
        local os_version=$(echo "$VERSION_ID" | tr -d '.')
        if [ "$os_version" == "2004" ] || [ "$os_version" == "10" ] || [ "$os_version" == "11" ]; then
            CURL_SSL_CIPHERS_OPT='-k --ciphers DEFAULT@SECLEVEL=1'
        fi
    fi

    if command_exists usleep; then
        USE_USLEEP=1
    fi
}

process() {
    local iface=''
    local xip=''
    local proxy=''
    USE_NIC=''
    NETWORK_TYPE=''
    LANGUAGE=''
    X_FORWARD=''
    USE_PROXY=''

    while [ $# -gt 0 ]; do
        case "$1" in
        -I | --interface)
            local iface="$2"
            USE_NIC="--interface $2"
            shift
            ;;
        -M | --network-type)
            local netType="$2"
            shift
            ;;
        -E | --language)
            LANGUAGE="$2"
            shift
            ;;
        -X | --x-forwarded-for)
            local xip="$2"
            shift
            ;;
        -P | --proxy)
            local proxy="$2"
            shift
            ;;
        -R | --region)
            local regionid="$2"
            shift
            ;;
        *)
            echo -e "${Font_Red}Unknown error while processing options.${Font_Suffix}"
            exit 1
            ;;
        esac
        shift
    done

    if [ -z "$iface" ]; then
        USE_NIC=''
    fi

    if [ -z "$xip" ]; then
        X_FORWARD=''
    fi

    if [ -n "$xip" ]; then
        local xip=$(echo "$xip" | awk '{$1=$1; print}')
        validate_ip_address "$xip"
        local result="$?"
        if [ "$result" == 4 ] || [ "$result" == 6 ]; then
            X_FORWARD="--header X-Forwarded-For:$xip"
        fi
    fi

    if [ -z "$proxy" ]; then
        USE_PROXY=''
    fi

    if [ -n "$proxy" ]; then
        local proxy=$(echo "$proxy" | awk '{$1=$1; print}')
        if validate_proxy "$proxy"; then
            USE_PROXY="-x $proxy"
        fi
    fi

    if [ -z "$netType" ]; then
        NETWORK_TYPE=''
    fi

    if [ -n "$netType" ]; then
        local netType=$(echo "$netType" | awk '{$1=$1; print}')
        if validate_net_type "$netType"; then
            NETWORK_TYPE="$netType"
        fi
    fi

    if [ -z "$LANGUAGE" ]; then
        LANGUAGE='zh'
    fi

    if [ -n "$regionid" ]; then
        if validate_region_id "$regionid"; then
            REGION_ID="$regionid"
        fi
    fi

    CURL_OPTS="$USE_NIC $USE_PROXY $X_FORWARD ${CURL_SSL_CIPHERS_OPT} --max-time 10 --retry 3 --retry-max-time 20"
}

delay() {
    if [ -z $1 ]; then
        exit 1
    fi
    local val=$1
    if [ "$USE_USLEEP" == 1 ]; then
        usleep $(awk 'BEGIN{print '$val' * 1000000}')
        return 0
    fi
    sleep $val
    return 0
}

count_run_times() {
    local tmpresult=$(curl ${CURL_OPTS} -s "https://hits.seeyoufarm.com/api/count/incr/badge.svg?url=https%3A%2F%2Fcheck.unclock.media&count_bg=%2379C83D&title_bg=%23555555&icon=&icon_color=%23E7E7E7&title=visit&edge_flat=false")
    TODAY_RUN_TIMES=$(echo "$tmpresult" | tail -3 | head -n 1 | awk '{print $5}')
    TOTAL_RUN_TIMES=$(($(echo "$tmpresult" | tail -3 | head -n 1 | awk '{print $7}') + 2527395))
}

download_extra_data() {
    MEDIA_COOKIE=$(curl ${CURL_OPTS} -s "https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/cookies")
    IATACODE=$(curl ${CURL_OPTS} -s "https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/IATACode.txt")
    IATACODE2=$(curl ${CURL_OPTS} -s "https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/IATACode2.txt")
    if [ -z "$MEDIA_COOKIE" ] || [ -z "$IATACODE" ] || [ -z "$IATACODE2" ]; then
        echo -e "${Font_Red}Extra data download failed.${Font_Suffix}"
        delay 3
    fi
}

get_ip_info() {
    LOCAL_IP_ASTERISK=''
    LOCAL_ISP=''
    local local_ip=$(curl ${CURL_DEFAULT_OPTS} -s https://api64.ipify.org --user-agent "${UA_BROWSER}")
    local get_local_isp=$(curl ${CURL_DEFAULT_OPTS} -s "https://api.ip.sb/geoip/${local_ip}" -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")

    if [ -z "$local_ip" ]; then
        echo -e "${Font_Red}Failed to Query IP Address.${Font_Suffix}"
    fi
    if [ -z "$get_local_isp" ]; then
        echo -e "${Font_Red}Failed to Query IP Info.${Font_Suffix}"
    fi

    validate_ip_address "$local_ip"
    local resp="$?"
    if [ "$resp" == 4 ]; then
        LOCAL_IP_ASTERISK=$(awk -F"." '{print $1"."$2".*.*"}' <<<"${local_ip}")
    fi
    if [ "$resp" == 6 ]; then
        LOCAL_IP_ASTERISK=$(awk -F":" '{print $1":"$2":"$3":*:*"}' <<<"${local_ip}")
    fi

    LOCAL_ISP=$(echo "$get_local_isp" | grep 'organization' | cut -f4 -d '"')
}

show_region() {
    echo -e "${Font_Yellow} ---${1}---${Font_Suffix}"
}

function GameTest_Steam() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Steam Currency:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://store.steampowered.com/app/761830' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Steam Currency:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep 'priceCurrency' | cut -d '"' -f4)
    if [ -z "$result" ]; then
        echo -n -e "\r Steam Currency:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Steam Currency:\t\t\t${Font_Green}${result}${Font_Suffix}\n"
}

# 流媒体解锁测试-动画疯
function MediaUnlockTest_BahamutAnime() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Bahamut Anime:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://ani.gamer.com.tw/ajax/getdeviceid.php' --cookie-jar bahamut_cookie.txt --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Bahamut Anime:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        rm -f bahamut_cookie.txt
        return
    fi

    local tempdeviceid=$(echo "$tmpresult" | grep -woP '"deviceid"\s{0,}:\s{0,}"\K[^"]+')
    # I Was Reincarnated as the 7th Prince
    local sn='37783'
    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -sL "https://ani.gamer.com.tw/ajax/token.php?adID=89422&sn=${sn}&device=${tempdeviceid}" -b bahamut_cookie.txt --user-agent "${UA_BROWSER}")
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://ani.gamer.com.tw/' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: zh-CN,zh;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-model: ""' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-ch-ua-platform-version: "15.0.0"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -b bahamut_cookie.txt --user-agent "${UA_BROWSER}")
    rm -f bahamut_cookie.txt
    if [ -z "$tmpresult1" ] || [ -z "$tmpresult2" ]; then
        echo -n -e "\r Bahamut Anime:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult1" | grep 'animeSn')

    if [ -z "$result" ]; then
        echo -n -e "\r Bahamut Anime:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult2" | grep -woP 'data-geo="\K[^"]+')
    if [ -n "$region" ]; then
        echo -n -e "\r Bahamut Anime:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Bahamut Anime:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

# 流媒体解锁测试-哔哩哔哩大陆限定
function MediaUnlockTest_BilibiliChinaMainland() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r BiliBili China Mainland Only:\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local randsession=$(gen_uuid | md5sum | head -c 32)
    # 尝试获取成功的结果
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL "https://api.bilibili.com/pgc/player/web/playurl?avid=82846771&qn=0&type=&otype=json&ep_id=307247&fourk=1&fnver=0&fnval=16&session=${randsession}&module=bangumi" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r BiliBili China Mainland Only:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[-\d]+' | head -n 1)
    case "$result" in
        '0') echo -n -e "\r BiliBili China Mainland Only:\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '-10403') echo -n -e "\r BiliBili China Mainland Only:\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r BiliBili China Mainland Only:\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

# 流媒体解锁测试-哔哩哔哩港澳台限定
function MediaUnlockTest_BilibiliHKMCTW() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r BiliBili Hongkong/Macau/Taiwan:\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local randsession=$(gen_uuid | md5sum | head -c 32)
    # 尝试获取成功的结果
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL "https://api.bilibili.com/pgc/player/web/playurl?avid=18281381&cid=29892777&qn=0&type=&otype=json&ep_id=183799&fourk=1&fnver=0&fnval=16&session=${randsession}&module=bangumi" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r BiliBili Hongkong/Macau/Taiwan:\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[-\d]+' | head -n 1)
    case "$result" in
        '0') echo -n -e "\r BiliBili Hongkong/Macau/Taiwan:\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '-10403') echo -n -e "\r BiliBili Hongkong/Macau/Taiwan:\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r BiliBili Hongkong/Macau/Taiwan:\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

# 流媒体解锁测试-哔哩哔哩台湾限定
function MediaUnlockTest_BilibiliTW() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Bilibili Taiwan Only:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local randsession=$(gen_uuid | md5sum | head -c 32)
    # 尝试获取成功的结果
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL "https://api.bilibili.com/pgc/player/web/playurl?avid=50762638&cid=100279344&qn=0&type=&otype=json&ep_id=268176&fourk=1&fnver=0&fnval=16&session=${randsession}&module=bangumi" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Bilibili Taiwan Only:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[-\d]+' | head -n 1)
    case "$result" in
        '0') echo -n -e "\r Bilibili Taiwan Only:\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '-10403') echo -n -e "\r Bilibili Taiwan Only:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Bilibili Taiwan Only:\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_AbemaTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Abema.TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://api.abema.io/v1/ip/check?device=android' --user-agent "${UA_ANDROID}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Abema.TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP '"isoCountryCode"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$region" ]; then
        echo -n -e "\r Abema.TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$region" == 'JP' ]; then
        echo -n -e "\r Abema.TV:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
    else
        echo -n -e "\r Abema.TV:\t\t\t\t${Font_Yellow}Oversea Only (Region: ${region})${Font_Suffix}\n"
    fi
}

function GameTest_PCRJP() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Princess Connect Re:Dive Japan:\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://api-priconne-redive.cygames.jp/' -w %{http_code} -o /dev/null --user-agent "${UA_ANDROID}")

    case "$result" in
        '000') echo -n -e "\r Princess Connect Re:Dive Japan:\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '404') echo -n -e "\r Princess Connect Re:Dive Japan:\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Princess Connect Re:Dive Japan:\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Princess Connect Re:Dive Japan:\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function GameTest_UMAJP() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://api-umamusume.cygames.jp/' -w %{http_code} -o /dev/null --user-agent "${UA_ANDROID}")

    case "$result" in
        '000') echo -n -e "\r Pretty Derby Japan:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '404') echo -n -e "\r Pretty Derby Japan:\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Pretty Derby Japan:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Pretty Derby Japan:\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function GameTest_Kancolle() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Kancolle Japan:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'http://203.104.209.7/kcscontents/twitter/maintenance_info.html' -w %{http_code} -o /dev/null --user-agent "${UA_ANDROID}")
    # curl 'http://203.104.209.7/kcscontents/twitter/maintenance_info.html' \
    # -H 'Accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' \
    # -H 'Accept-Language: en-US,en;q=0.9' \
    # -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' \
    # --insecure

    case "$result" in
        '000') echo -n -e "\r Kancolle Japan:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Kancolle Japan:\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Kancolle Japan:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Kancolle Japan:\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Lemino() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://if.lemino.docomo.ne.jp/v1/user/delivery/watch/ready' -w %{http_code} -o /dev/null -H 'accept: application/json, text/plain, */*' -H 'accept-language: en-US,en;q=0.9' -H 'content-type: application/json' -H 'origin: https://lemino.docomo.ne.jp' -H 'referer: https://lemino.docomo.ne.jp/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H 'x-service-token: f365771afd91452fa279863f240c233d' -H 'x-trace-id: 556db33f-d739-4a82-84df-dd509a8aa179' --data-raw '{"inflow_flows":[null,"crid://plala.iptvf.jp/group/b100ce3"],"play_type":1,"key_download_only":null,"quality":null,"groupcast":null,"avail_status":"1","terminal_type":3,"test_account":0,"content_list":[{"kind":"main","service_id":null,"cid":"00lm78dz30","lid":"a0lsa6kum1","crid":"crid://plala.iptvf.jp/vod/0000000000_00lm78dymn","preview":0,"trailer":0,"auto_play":0,"stop_position":0}]}' --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Lemino:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Lemino:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Lemino:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Lemino:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

MediaUnlockTest_AnimeFesta() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://api-animefesta.iowl.jp/v1/titles/1560' -w %{http_code} -o /dev/null -H 'accept: application/json' -H 'accept-language: en-US,en;q=0.9' -H 'anime-user-tracking-id: yEZr4P_U7JEdBucZOkv1Y' -H 'authorization;' -H 'origin: https://animefesta.iowl.jp' -H 'referer: https://animefesta.iowl.jp/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty'  -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H 'sec-gpc: 1' -H 'x-requested-with: XMLHttpRequest' --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r AnimeFesta:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r AnimeFesta:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r AnimeFesta:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r AnimeFesta:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_mora() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Mora:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://mora.jp/buy?__requestToken=1713764407153&returnUrl=https%3A%2F%2Fmora.jp%2Fpackage%2F43000087%2FTFDS01006B00Z%2F%3Ffmid%3DTOPRNKS%26trackMaterialNo%3D31168909&fromMoraUx=false&deleteMaterial=' -w %{http_code} -o /dev/null -H 'host: mora.jp' --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Mora:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Mora:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Mora:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '500') echo -n -e "\r Mora:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Mora:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_BBCiPLAYER() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r BBC iPLAYER:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://open.live.bbc.co.uk/mediaselector/6/select/version/2.0/mediaset/pc/vpid/bbc_one_london/format/json/jsfunc/JS_callbacks0' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r BBC iPLAYER:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'geolocation')
    local isOK=$(echo "$tmpresult" | grep -i 'vs-hls-push-uk')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r BBC iPLAYER:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r BBC iPLAYER:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r BBC iPLAYER:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r BBC iPLAYER:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Netflix() {
    # LEGO Ninjago
    local result1=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.netflix.com/title/81280792' -w %{http_code} -o /dev/null -H 'host: www.netflix.com' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-site: none' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-user: ?1' -H 'sec-fetch-dest: document' --user-agent "${UA_BROWSER}")
    # Breaking bad
    local result2=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.netflix.com/title/70143836' -w %{http_code} -o /dev/null -H 'host: www.netflix.com' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-site: none' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-user: ?1' -H 'sec-fetch-dest: document' --user-agent "${UA_BROWSER}")

    if [ "${result1}" == '000' ] || [ "$result2" == '000' ]; then
        echo -n -e "\r Netflix:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ "$result1" == '404' ] && [ "$result2" == '404' ]; then
        echo -n -e "\r Netflix:\t\t\t\t${Font_Yellow}Originals Only${Font_Suffix}\n"
        return
    fi
    if [ "$result1" == '403' ] || [ "$result2" == '403' ]; then
        echo -n -e "\r Netflix:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$result1" == '200' ] || [ "$result2" == '200' ]; then
        local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.netflix.com/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-site: none' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-user: ?1' -H 'sec-fetch-dest: document' --user-agent "${UA_BROWSER}")
        local region=$(echo "$tmpresult" | grep -oP '"id":"\K[^"]+' | grep -E '^[A-Z]{2}$' | head -n 1)
        echo -n -e "\r Netflix:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Netflix:\t\t\t\t\t${Font_Red}Failed (Error: ${result1}_${result2})${Font_Suffix}\n"
}

function MediaUnlockTest_DisneyPlus() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tempresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://disney.api.edge.bamgrid.com/devices' -X POST -H "authorization: Bearer ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84" -H "content-type: application/json; charset=UTF-8" -d '{"deviceFamily":"browser","applicationRuntime":"chrome","deviceProfile":"windows","attributes":{}}' --user-agent "${UA_BROWSER}")
    if [ -z "$tempresult" ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local is403=$(echo "$tempresult" | grep -i '403 ERROR')
    if [ -n "$is403" ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Red}No (IP Banned By Disney+)${Font_Suffix}\n"
        return
    fi

    local assertion=$(echo "$tempresult" | grep -woP '"assertion"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$assertion" ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local preDisneyCookie=$(echo "$MEDIA_COOKIE" | sed -n '1p')
    local disneyCookie=$(echo "$preDisneyCookie" | sed "s/DISNEYASSERTION/${assertion}/g")
    local tokenContent=$(curl ${CURL_DEFAULT_OPTS} -s 'https://disney.api.edge.bamgrid.com/token' -X POST -H "authorization: Bearer ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84" -d "${disneyCookie}" --user-agent "${UA_BROWSER}")

    local isBlocked=$(echo "$tokenContent" | grep -i 'forbidden-location')
    local is403=$(echo "$tokenContent" | grep -i '403 ERROR')

    if [ -n "$isBlocked" ] || [ -n "$is403" ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Red}No (IP Banned By Disney+ 1)${Font_Suffix}\n"
        return
    fi

    local fakeContent=$(echo "$MEDIA_COOKIE" | sed -n '8p')
    local refreshToken=$(echo "$tokenContent" | grep -woP '"refresh_token"\s{0,}:\s{0,}"\K[^"]+')
    local disneyContent=$(echo "$fakeContent" | sed "s/ILOVEDISNEY/${refreshToken}/g")
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://disney.api.edge.bamgrid.com/graph/v1/device/graphql' -X POST -H "authorization: ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84" -d "${disneyContent}" --user-agent "${UA_BROWSER}")

    local previewcheck=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://disneyplus.com' -w '%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local isUnavailable=$(echo "$previewcheck" | grep -E 'preview|unavailable')
    local region=$(echo "$tmpresult" | grep -woP '"countryCode"\s{0,}:\s{0,}"\K[^"]+')
    local inSupportedLocation=$(echo "$tmpresult" | grep -woP '"inSupportedLocation"\s{0,}:\s{0,}\K(false|true)')

    if [ -z "$region" ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$region" == 'JP' ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Green}Yes (Region: JP)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isUnavailable" ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$inSupportedLocation" == 'false' ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Yellow}Available For [Disney+ ${region}] Soon${Font_Suffix}\n"
        return
    fi
    if [ "$inSupportedLocation" == 'true' ]; then
        echo -n -e "\r Disney+:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Disney+:\t\t\t\t${Font_Red}Failed (Error: ${inSupportedLocation}_${region})${Font_Suffix}\n"
}

function MediaUnlockTest_Dazn() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Dazn:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://startup.core.indazn.com/misl/v5/Startup' -X POST -H "Content-Type: application/json" -d '{"LandingPageKey":"generic","languages":"en-US,en","Platform":"web","PlatformAttributes":{},"Manufacturer":"","PromoCode":"","Version":"2"}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Dazn:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"isAllowed"\s{0,}:\s{0,}\K(false|true)')
    local region=$(echo "$tmpresult" | grep -woP '"GeolocatedCountry"\s{0,}:\s{0,}"\K[^"]+' | tr a-z A-Z)
    case "$result" in
        'false') echo -n -e "\r Dazn:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'true') echo -n -e "\r Dazn:\t\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n" ;;
        *) echo -n -e "\r Dazn:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_HuluJP() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Hulu Japan:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://id.hulu.jp/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null -H 'Accept: */*;q=0.8' -H 'Accept-Language: en-US,en;q=0.5' -H 'Accept-Encoding: none' -H 'Sec-GPC: 1' -H 'Upgrade-Insecure-Requests: 1' -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Site: none' -H 'Sec-Fetch-User: ?1' -H 'Priority: u=1' --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Hulu Japan:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep 'restrict')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Hulu Japan:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Hulu Japan:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r Hulu Japan:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Hulu Japan:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_MyTVSuper() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r MyTVSuper:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.mytvsuper.com/api/auth/getSession/self/' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r MyTVSuper:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"country_code"\s{0,}:\s{0,}"\K[^"]+')
    if [ "$result" == 'HK' ]; then
        echo -n -e "\r MyTVSuper:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    else
        echo -n -e "\r MyTVSuper:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r MyTVSuper:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n"
}

function MediaUnlockTest_NowE() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Now E:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://webtvapi.nowe.com/16/1/getVodURL' \
        -H 'accept: application/json, text/javascript, */*; q=0.01' \
        -H 'accept-language: zh-CN,zh;q=0.9,en-GB;q=0.8,en;q=0.7,en-US;q=0.6' \
        -H 'content-type: text/plain' \
        -H 'origin: https://www.nowe.com' \
        -H 'priority: u=1, i' \
        -H 'referer: https://www.nowe.com/' \
        -H 'sec-fetch-dest: empty' \
        -H 'sec-fetch-mode: cors' \
        -H 'sec-fetch-site: same-site' \
        -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/131.0.0.0' \
        --data-raw '{"contentId":"202310181863841","contentType":"Vod","pin":"","deviceName":"Browser","deviceId":"w-678913af-3998-3998-3998-39983998","deviceType":"WEB","secureCookie":null,"callerReferenceNo":"W17370372345461425","profileId":null,"mupId":null,"trackId":"738296446.226.1737037103860.2","sessionId":"c39f03e6-9e74-4d24-a82f-e0d0f328bb70"}')

    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Now E:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"OTTAPI_ResponseCode"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        'GEO_CHECK_FAIL') echo -n -e "\r Now E:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'SUCCESS') echo -n -e "\r Now E:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Now E:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_ViuTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Viu.TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.viu.now.com/p8/3/getLiveURL' -X POST -H "Content-Type: application/json" -d '{"callerReferenceNo":"20210726112323","contentId":"099","contentType":"Channel","channelno":"099","mode":"prod","deviceId":"29b3cb117a635d5b56","deviceType":"ANDROID_WEB"}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Viu.TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"responseCode"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        'GEO_CHECK_FAIL') echo -n -e "\r Viu.TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'SUCCESS') echo -n -e "\r Viu.TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Viu.TV:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_unext() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://cc.unext.jp' -H 'content-type: application/json' --data-raw '{"operationName":"cosmo_getPlaylistUrl","variables":{"code":"ED00479780","playMode":"caption","bitrateLow":192,"bitrateHigh":null,"validationOnly":false},"query":"query cosmo_getPlaylistUrl($code: String, $playMode: String, $bitrateLow: Int, $bitrateHigh: Int, $validationOnly: Boolean) {\n  webfront_playlistUrl(\n    code: $code\n    playMode: $playMode\n    bitrateLow: $bitrateLow\n    bitrateHigh: $bitrateHigh\n    validationOnly: $validationOnly\n  ) {\n    subTitle\n    playToken\n    playTokenHash\n    beaconSpan\n    result {\n      errorCode\n      errorMessage\n      __typename\n    }\n    resultStatus\n    licenseExpireDate\n    urlInfo {\n      code\n      startPoint\n      resumePoint\n      endPoint\n      endrollStartPosition\n      holderId\n      saleTypeCode\n      sceneSearchList {\n        IMS_AD1\n        IMS_L\n        IMS_M\n        IMS_S\n        __typename\n      }\n      movieProfile {\n        cdnId\n        type\n        playlistUrl\n        movieAudioList {\n          audioType\n          __typename\n        }\n        licenseUrlList {\n          type\n          licenseUrl\n          __typename\n        }\n        __typename\n      }\n      umcContentId\n      movieSecurityLevelCode\n      captionFlg\n      dubFlg\n      commodityCode\n      movieAudioList {\n        audioType\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n"}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r U-NEXT:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"resultStatus"\s{0,}:\s{0,}\K\d+')
    case "$result" in
        '475') echo -n -e "\r U-NEXT:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '200') echo -n -e "\r U-NEXT:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '467') echo -n -e "\r U-NEXT:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r U-NEXT:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_wowow() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local timestamp=$[$(date +%s%N)/1000000]
    # 取原创剧集列表
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s "https://www.wowow.co.jp/drama/original/json/lineup.json?_=${timestamp}" -H 'Accept: application/json, text/javascript, */*; q=0.01' -H 'Referer: https://www.wowow.co.jp/drama/original/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-origin' -H 'X-Requested-With: XMLHttpRequest' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    # 取无料剧集来播放 example: https://www.wowow.co.jp/drama/original/hakubo/
    local playUrlList=$(echo "$tmpresult" | grep -woP '"link"\s{0,}:\s{0,}"\K[^"]+' | grep 'drama/original' | head -n 4 | xargs)
    if [ -z "$playUrlList" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    for playUrl in $playUrlList ; do
        # 访问并获取真实链接
        local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s "${playUrl}" --user-agent "${UA_BROWSER}")
        if [ -z "$tmpresult2" ]; then
            echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
            return
        fi

        # 取得真实链接
        local wodUrl=$(echo "$tmpresult2" | grep -o '"https://wod.wowow.co.jp/content/.*"' | cut -f2 -d'"' | head -n 1)
        if [ -n "$wodUrl" ]; then
            break
        fi
    done

    if [ -z "$wodUrl" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR 1)${Font_Suffix}\n"
        return
    fi

    # 访问并获取 meta_id
    local tmpresult3=$(curl ${CURL_DEFAULT_OPTS} -s "$wodUrl" -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")

    if [ -z "$tmpresult3" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Network Connection 2)${Font_Suffix}\n"
        return
    fi

    local metaId=$(echo "$tmpresult3" | grep -woP '"https://wod.wowow.co.jp/watch/\K\d{0,}[^"]+')
    # Fake Vistor UID
    local vUid=$(echo -n "$timestamp" | md5sum | cut -f1 -d' ')
    # 最终测试
    local tmpresult4=$(curl ${CURL_DEFAULT_OPTS} -s 'https://mapi.wowow.co.jp/api/v1/playback/auth' -H 'accept: application/json, text/plain, */*' -H 'content-type: application/json;charset=UTF-8' -H 'origin: https://wod.wowow.co.jp' -H 'referer: https://wod.wowow.co.jp/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H 'x-requested-with: XMLHttpRequest' --data-raw "{\"meta_id\":${metaId},\"vuid\":\"${vUid}\",\"device_code\":1,\"app_id\":1,\"ua\":\"${UA_BROWSER}\"}" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult4" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Network Connection 3)${Font_Suffix}\n"
        return
    fi
    local isBlocked=$(echo "$tmpresult4" | grep -i 'VPN')
    local isOK=$(echo "$tmpresult4" | grep -i 'playback_session_id')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR 2)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r WOWOW:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_TVer() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://platform-api.tver.jp/v2/api/platform_users/browser/create' -H 'content-type: application/x-www-form-urlencoded' -H 'origin: https://s.tver.jp' -H 'referer: https://s.tver.jp/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --data-raw 'device_type=pc' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    # 先取 UID 和 TOKEN
    local platformUid=$(echo "$tmpresult" | grep -woP '"platform_uid"\s{0,}:\s{0,}"\K[^"]+')
    local platformToken=$(echo "$tmpresult" | grep -woP '"platform_token"\s{0,}:\s{0,}"\K[^"]+')
    # 根据 UID 和 TOKEN 取得当前正在播放的剧集
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s "https://platform-api.tver.jp/service/api/v1/callHome?platform_uid=${platformUid}&platform_token=${platformToken}&require_data=mylist%2Cresume%2Clater" -H 'origin: https://tver.jp' -H 'referer: https://tver.jp/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H 'x-tver-platform-type: web' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi
    # 返回结果取新电视剧第一个值
    # echo "$tmpresult2" | jq  -r '.result.components.[] | select(.componentID | contains("newer-drama")) | limit(1; .contents.[].content.id)'
    local episodeId=$(echo "$tmpresult2" | sed -E 's/.*"variety.catchup.recomend([.]{0,})"//' | sed 's/"componentID".*//' | sed 's/"id"/_TAG_/;s/.*_TAG_//' | cut -f2 -d'"' | grep -E '[a-z0-9]{10}')
    if [ -z "$episodeId" ]; then
        echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    # 取得该剧集信息
    local tmpresult3=$(curl ${CURL_DEFAULT_OPTS} -s "https://statics.tver.jp/content/episode/${episodeId}.json" -H 'origin: https://tver.jp' -H 'referer: https://tver.jp/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult3" ]; then
        echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}Failed (Network Connection 2)${Font_Suffix}\n"
        return
    fi
    # 取 accountID / playerID / videoID / videoRefID
    local accountID=$(echo "$tmpresult3" | grep -woP '"accountID"\s{0,}:\s{0,}"\K[^"]+')
    local playerID=$(echo "$tmpresult3" | grep -woP '"playerID"\s{0,}:\s{0,}"\K[^"]+')
    local videoID=$(echo "$tmpresult3" | grep -woP '"videoID"\s{0,}:\s{0,}"\K[^"]+')
    local videoRefID=$(echo "$tmpresult3" | grep -woP '"videoRefID"\s{0,}:\s{0,}"\K[^"]+' | head -n 1)
    # 取得 brightcove 播放器信息
    local tmpresult4=$(curl ${CURL_DEFAULT_OPTS} -s "https://players.brightcove.net/${accountID}/${playerID}_default/index.min.js" -H 'Referer: https://tver.jp/' -H 'Sec-Fetch-Dest: script' -H 'Sec-Fetch-Mode: no-cors' -H 'Sec-Fetch-Site: cross-site' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult4" ]; then
        echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}Failed (Network Connection 3)${Font_Suffix}\n"
        return
    fi
    # 取 policy_key
    local policyKey=$(echo "$tmpresult4" | sed 's/.*policyKey:"//' | awk -F'"' '{print $1}')

    if [ -z "${videoRefID}" ]; then
        # 取 deliveryConfigId
        local deliveryConfigId=$(echo "$tmpresult4" | sed 's/.*deliveryConfigId:"//' | awk -F'"' '{print $1}')
        # 最终检查
        local tmpresult5=$(curl ${CURL_DEFAULT_OPTS} -s "https://edge.api.brightcove.com/playback/v1/accounts/${accountID}/videos/${videoID}?config_id=${deliveryConfigId}" -H "accept: application/json;pk=${policyKey}" -H 'origin: https://tver.jp' -H 'referer: https://tver.jp/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' --user-agent "${UA_BROWSER}")
    else
        # 最终检查
        local tmpresult5=$(curl ${CURL_DEFAULT_OPTS} -s "https://edge.api.brightcove.com/playback/v1/accounts/${accountID}/videos/ref%3A${videoRefID}" -H "accept: application/json;pk=${policyKey}" -H 'origin: https://tver.jp' -H 'referer: https://tver.jp/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' --user-agent "${UA_BROWSER}")
    fi

    if [ -z "$tmpresult5" ]; then
        echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}Failed (Network Connection 4)${Font_Suffix}\n"
        return
    fi
    local result=$(echo "$tmpresult5" | grep -woP '"error_subcode"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        'CLIENT_GEO') echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '') echo -n -e "\r TVer:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r TVer:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_HamiVideo() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Hami Video:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://hamivideo.hinet.net/api/play.do?id=OTT_VOD_0000249064&freeProduct=1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Hami Video:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        '06001-106') echo -n -e "\r Hami Video:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '06001-107') echo -n -e "\r Hami Video:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Hami Video:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_4GTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r 4GTV.TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} --tlsv1.3 -s 'https://api2.4gtv.tv/Web/IsTaiwanArea' -H 'origin: https://www.4gtv.tv' -H 'referer: https://www.4gtv.tv/' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r 4GTV.TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    result=$(echo "$tmpresult" | grep -woP '"Data"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        'N') echo -n -e "\r 4GTV.TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'Y') echo -n -e "\r 4GTV.TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r 4GTV.TV:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_SlingTV() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.sling.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Sling TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep -i 'geo-block')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Sling TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Sling TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Sling TV:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_PlutoTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Pluto TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://pluto.tv/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Pluto TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep 'plutotv-is-not-available')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Pluto TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Pluto TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Pluto TV:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_HBOMax() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sLi 'https://www.max.com/' -w "_TAG_%{http_code}_TAG_" --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r HBO Max:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local countryList=$(echo "$tmpresult" | grep -woP '"url":"/[a-z]{2}/[a-z]{2}"' | cut -f4 -d'"' | cut -f2 -d'/' | sort -n | uniq | xargs | tr a-z A-Z)
    local countryList="${countryList} US"
    local region=$(echo "$tmpresult" | grep -woP 'countryCode=\K[A-Z]{2}' | head -n 1)
    local isUnavailable=$(echo "$countryList" | grep "$region")

    if [ -z "$region" ]; then
        echo -n -e "\r HBO Max:\t\t\t\t${Font_Red}Failed (Error: Country Code Not Found)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isUnavailable" ]; then
        echo -n -e "\r HBO Max:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r HBO Max:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_Showmax() {
    local region=$(curl ${CURL_DEFAULT_OPTS} -si 'https://www.showmax.com/' -H 'host: www.showmax.com' -H 'connection: keep-alive' -H 'sec-ch-ua: "Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"' -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'upgrade-insecure-requests: 1' -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0' -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'sec-fetch-site: none' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-user: ?1' -H 'sec-fetch-dest: document' -H 'accept-language: zh-CN,zh;q=0.9' 2>&1 | grep 'activeTerritory'| awk -F'[=;]' '{print $2}')
    if [[ "$region" == "curl"* ]]; then
        echo -n -e "\r Showmax:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ -n "$region" ]; then
        echo -n -e "\r Showmax:\t\t\t\t${Font_Green}Yes (Region: $region)${Font_Suffix}\n"
        return
    elif [ -z "$region" ]; then
        echo -n -e "\r Showmax:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    else
        echo -n -e "\r Showmax:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
}

function MediaUnlockTest_Channel4() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Channel 4:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.channel4.com/simulcast/channels/C4' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Channel 4:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Channel 4:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Channel 4:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Channel 4:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_ITVHUB() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r ITV Hub:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://magni.itv.com/playlist/itvonline/ITV/10_4782_0001.001' -H 'Accept: application/vnd.itv.vod.playlist.v2+json' -H 'Accept-Language: en-US,en;q=0.9' -H 'Content-Type: application/json' -H 'Origin: https://www.itv.com' -H 'Referer: https://www.itv.com/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-site' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --data-raw '{"user":{"entitlements":[]},"device":{"manufacturer":"Chrome","model":"125.0.0.0","os":{"name":"Windows","version":"10","type":"desktop"}},"client":{"version":"4.1","id":"browser","supportsAdPods":true,"service":"itv.x","appversion":"2.237.0"},"variantAvailability":{"player":"dash","featureset":{"min":["mpeg-dash","widevine","outband-webvtt","hd","single-track"],"max":["mpeg-dash","widevine","outband-webvtt","hd","single-track"]},"platformTag":"dotcom"}}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r ITV Hub:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'Outside Of Allowed Geographic')
    local isOK=$(echo "$tmpresult" | grep -i 'Playlist')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r ITV Hub:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r ITV Hub:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r ITV Hub:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r ITV Hub:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_DSTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r DSTV:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL --tlsv1.3 'https://authentication.dstv.com/favicon.ico' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r DSTV:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '403'|'451') echo -n -e "\r DSTV:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '404') echo -n -e "\r DSTV:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r DSTV:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function RegionTest_iQYI() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r iQyi Oversea Region:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.iq.com/' -w "_TAG_%{http_code}_TAG_" -o /dev/null --user-agent "${UA_BROWSER}" -D -)

    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r iQyi Oversea Region:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP 'mod=\K[a-z]+' | tr a-z A-Z)
    if [ -z "$region" ]; then
        echo -n -e "\r iQyi Oversea Region:\t\t\t${Font_Red}Failed (Error: Country Code Not Found)${Font_Suffix}\n"
        return
    fi

    if [ "$region" == 'NTW' ]; then
        region='TW'
    fi

    echo -n -e "\r iQyi Oversea Region:\t\t\t${Font_Green}${region}${Font_Suffix}\n"
}

function MediaUnlockTest_HuluUS() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://auth.hulu.com/v4/web/password/authenticate' -H 'Accept: application/json' -H 'accept-language: en-US,en;q=0.9' -H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8' -H 'Cookie: _hulu_at=eyJhbGciOiJSUzI1NiJ9.eyJhc3NpZ25tZW50cyI6ImV5SjJNU0k2VzExOSIsInJlZnJlc2hfaW50ZXJ2YWwiOjg2NDAwMDAwLCJ0b2tlbl9pZCI6IjQyZDk0YzA5LWYyZTEtNDdmNC1iYzU4LWUwNTA2NGNhYTdhZCIsImFub255bW91c19pZCI6IjYzNDUzMjA2LWFmYzgtNDU4Yi1iODBkLWNiMzk2MmYzZGQyZCIsImlzc3VlZF9hdCI6MTcwNjYwOTUzODc5MiwidHRsIjozMTUzNjAwMDAwMCwiZGV2aWNlX3VwcGVyIjoxfQ.e7sRCOndgn1j30XYkenLcLSQ7vwc2PXk-gFHMIF2gu_3UNEJ3pp3xNOZMN0n7DQRw5Jv68WiGxIvf65s8AetOoD4NLt4sZUDDz9HCRmFHzpmAJdtXWZ-HZ4fYucENuqDDDrsdQ-FCc0mgIe2IXkmQJ6tpIN3Zgcgmpmbeoq6jYyLlqg6f8eMsI1bNAsBGGj-9DXw2PMotlYHWB22pw2NRfJw1TjWXwywRBodAOve7rsu2Vhx-A2-OH4GplRvxLqzCpl2pcjkYg9atmUB7jnNIf_jHqlek4oRRawahWq-2vWnWmb1eMQcH-v2IHs3YdVk7I-t4iS19auPQrdgo6jPaA; _hulu_assignments=eyJ2MSI6W119; bm_mi=8896E057E2FC39F20852615A0C46A2B4~YAAQZB0gFyQrnlSNAQAAU/naWRaCMaJFIPi3L8KYSiCL3AN7XHCPw0gKvdIl0XZ/VE3QiKEr31qjm9sPulHbdQ4XXIXPXZ53DpIK43fLybrT6WxIpmGz3iThk6+xefI2dPLzwBAdoTrsbAbHC2q4LDx0SBM+n21LvTD7UnT2+DyVBK75YCDJJKHlJ5jzB3Q81JIlmqfTzibjgVmPIxXrFdTs5Ll8mtp6WzE3VDISmjGjTRTrSOVYM0YGpyhye1nsm3zBCO13vDjKMCJ/6oAsVqBfgfW07e7sWkWeUiDYLUifRDymc4GaMhavenBvCma/G1qW~1; bm_sv=FEE04D9D797D0237C312D77F57DABBFD~YAAQZB0gFyUrnlSNAQAAU/naWRaMNI8KmoGX9XNJkm9x9VeeGzGQyPfu49M9MnLObz8D4ZYk9Td+3Y8Z/Jfx+kl2qOPXmtOC5GZpA++9bxUKV0SwaoGhivl+ibIJSQTc7lw4kzdM/2w8b3rwItRaHXFa+shMtD3eiKvBePrqCiezucqrcss1U4ojLKEOvcsKJGt6ZTGGs2H+Qu6cyns9BVN0BprMHRY3njHXyxbFIcGy8Lq7aPn6nuZ0ehfZ9Q==~1; ak_bmsc=55F791116713DDB91AB0978225853B77~000000000000000000000000000000~YAAQZB0gF6ErnlSNAQAAHALbWRaA625r4bWVW8g2gHV797RN8bfCwNy6KfnGEucUPiPt4QKjJUldR6lyaM7sarag6A7WLqxEFr/zAFlPQI12Uxsqdzg3IgU0R8g2eMQRnRoGMNSUPyt4rdCWWwGjEcM+dQ8TI+y1vKw9dLXoBJAHofaWe/dZhY4fx2mYKhKFibvdpwJT6UPe4rBz8igd9oTQBn69Ebi6/9YFykqGuKsllxa5+QZWczb0+HLLDRKV4CkZdhbFj0yljEOyz4GHqqP8qg3Xa3lCKzdzsrmPn6zdFbgzCE8HsyPjsmy+/rRfFxagH5rYudLqFXg5o5dXFFJPTiLXtZ/S30ckc/OUWk4JP2ywAQVm/zbp8nlRVMFDEdjIPh/F+5QXfYBV+yL4a85ThlBEXSr54/QWXiHxBRiOwhv2ydoZDfT78r9bUHbMOra37C0xutfo37fbYEw9LWlLdZCub9U5HA/zSeIN3KxrZr0yNKfJjOau7BqdHL+AuvDj134ZPZPVig==; _customer_type=anonymous; s_fid=66C80912997F4CF8-2D3140F8EDC76274; s_cc=true; _rdt_uuid=1706609517486.d5b309e4-2b0b-440f-9817-cf619e4ce15d; _gcl_au=1.1.602757068.1706609518; _scid=cc980fef-26dc-479a-b9a8-b0e531c87cd3; _scid_r=cc980fef-26dc-479a-b9a8-b0e531c87cd3; _tt_enable_cookie=1; _ttp=1h5M9exzlSz7wAFDR78KCHCsnDC; utag_main=v_id:018d59da9a5c00215e601dada5700507d001c07500bd0$_sn:1$_ss:0$_st:1706611329541$ses_id:1706609515101%3Bexp-session$_pn:1%3Bexp-session$_prevpage:%2Fwelcome%3Bexp-1706613129564$trial_duration:undefined%3Bexp-session$program_id:undefined%3Bexp-session$vapi_domain:hulu.com$g_sync_ran:1%3Bexp-session$dc_visit:1$dc_event:1%3Bexp-session$dc_region:ap-east-1%3Bexp-session; _hulu_metrics_context_v1_=%7B%22cookie_session_guid%22%3A%227dc4f3a6826f2c35125268f5ddab1849%22%2C%22referrer_url%22%3A%22%22%2C%22curr_page_uri%22%3A%22www.hulu.com%2Fwelcome%22%2C%22primary_ref_page_uri%22%3Anull%2C%22secondary_ref_page_uri%22%3Anull%2C%22curr_page_type%22%3A%22landing%22%2C%22primary_ref_page_type%22%3Anull%2C%22secondary_ref_page_type%22%3Anull%2C%22secondary_ref_click%22%3A%22%22%2C%22primary_ref_click%22%3A%22%22%7D; metrics_tracker_session_manager=%7B%22session_id%22%3A%22B26515EB8A7952D4D35F374465362A72-529671c4-c8c2-4c7c-8bff-cc201bcd4075%22%2C%22creation_time%22%3A1706609513429%2C%22visit_count%22%3A1%2C%22session_seq%22%3A4%2C%22idle_time%22%3A1706609529579%7D; guid=B26515EB8A7952D4D35F374465362A72; JSESSIONID=ED7031784C3B1843BFC9AACBB156C6BA; s_sq=wdghuluwebprod%3D%2526c.%2526a.%2526activitymap.%2526page%253Dwelcome%2526link%253DLOG%252520IN%2526region%253Dlogin-modal%2526pageIDType%253D1%2526.activitymap%2526.a%2526.c%2526pid%253Dwelcome%2526pidt%253D1%2526oid%253Dfunctionsn%252528%252529%25257B%25257D%2526oidt%253D2%2526ot%253DBUTTON; XSRF-TOKEN=bcfa1766-1f73-442d-a71b-e1cf6c275f45; _h_csrf_id=2a52618e9d006ac2e0b3e65740aa55e2584359553466051c3b01a2f1fb91726a' -H 'Origin: https://www.hulu.com' -H 'Referer: https://www.hulu.com/welcome' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-site' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --data-raw 'user_email=me%40jamchoi.cc&password=Jam0.5cm~&recaptcha_type=web_invisible&rrventerprise=03AFcWeA6UFet_b_82RUmGfFWJCWuqy6kIn854Rhqjwd7vrkjH6Vku1wBZy8-FBA3Efx1p2cuNnKeJRuk7yJWm-xZgFfUx0Wdj2OAhiGvIdWrcpfeuQSXEqaXH4FKdmAHVZ3EqHwe5-h_zgtcyIxq-Nn1-sjeUfx1Y7QyVkb_GWJcr0GLoKgTFLzbF4kmJ8Qsi4IFx9hyYo9TFbBqtYdgxCI2q9DnEzOHrxK-987PEY8qzsR08Hrb9oDvumqLp1gs4uEVTwDKWt37aNB3CMVBKL2lHj7n768kXpgkXFDIhcM2eiJJ-H22qxKzNUpg-Q_N1xzkYsavCJG3ckQgsCTRRP2NU3nIERTWDTVXRBEq52-_ZQWu_Ds4W4UZyP0hEhCD2gambN4YJqEzaeHdGPwOR943nFbG6GILBx4vY-UUc7zjMf2HRjkNPvPpQiHMIYo21JXq6l8-IWyTeHY26NU6M4vCCbzwZEsdSln48rXM_fdBcDHC-8AxUFuBR8j3DMsB6Q3xMS2EHeGVrmhDY1izDNJZsVC_cN0W2tRneOJmni7ZU1iAYoBAGBBM5FDTE4UbYUTnuUn-htm9Q0RzukpYTumF_WwQ3HnEL0JK1Q1xea-hteI8lB4oAkhVOBOHVPii9atdZR9ZLpxRh1pdy3Lwmr1ltsubxE05wqmrmt33P2WsvH_3nBJXC_FhTD06BxT60RuiGtFr2gscHjjl_NCa1F-Dv9Hgi5ek2nLHK37a84bRSoKwLL3Lnpi9byuBntlpf-UXj7nveawKZmZTUBOSc7j6Vmmf124DTPJXsFeofMfUXkqTauPTWJBOz0OdKnLKDHMSsk7oSJVKsDUEeq0iKMdtCMBPvQBaPYAb79LDRwv_ereqyklKcUKQxeZRZmEXLKIWp8BS4U9uTXA2w8hwZWe7goLnUBQATIwojeHKpypSLnzQBu9JCwMU4aXfKIplL8sXuAx3QFD52eGZSCEyuFXP3ACN53QOlTAjjlP2eDT9fEwWHT4o8eJfviyjvm8xDmzKtq4F3u5XB3tL86-dK40XYbGcTI0Irw1nz1UTcxplFgHQgb6i8WEAqb69CQkpGWAUlmnknBirRAv2adqPaW2d_lv6L3Eo-ZupWcZ9Cu4PibM5BruVNXifBwPNPXHKw-sWBj-UP1g9VtxHVEVwoTXrbB-lT8EvjDEDQKrvOwnri4_tzVzn6YKvQMELbxSegvmc2w7xypT2qFzKRFXqwTMLT9d0rf2p9tbwbe39REMR8oI7wPfbjyJjK2XF4DmEAyVvBMuJlBaBsKBs5VynITHFWs4xvkAOe4jO_fzkKXzB6F6DB03ldasxbrNK_cepUOF6FD39-pHvbAGcoTrDrx6FSfecYXwSvc3GxM3IHSKwISKWav2iqPMtIt6ClCgUPgTCBDng2ZptXeVG8FckGIGMEdVlgGt5DG2tdMO2p8Hs5tKXuu8anc_csaaSfLIQ1_kav0dp8vpSXhCxeg899o5coXderUoIBcUsfaBJJm80YnCAc4LaM8HmYtJBcKqCC_uwCckPDOuC0SQy3d07LEi6wyifvY0Kv_-ER6wXvhNWnDZIXJNlH2369X7y8o3y2HMisOwAhfmKN7_ZAaODEOO-5x9JHocAYnt4a8_focwU9JQ_hUQgtdzYpP1ACEqxVjJb0A0NlABpm-CG8V9n9y6XpZkGQiMYJIH3jr6VilHSEM9rQSEv6LN8NFigl3-5Y4Ri7W4joz3LUMQcjFj3qXd3AXonarXhwglVNB9BYquCdA5eq4wVUeAkm3R-e56TK5IZwpb5wNJDO3PhuXHSMwv1k-NEAIfI9_w&scenario=web_password_login&csrf=c2c20e89ce4e314771dcda79994b2cd020b9c30fc25faccdc1ebef3351a5b36b' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Hulu:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"name"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        'LOGIN_FORBIDDEN') echo -n -e "\r Hulu:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        'GEO_BLOCKED') echo -n -e "\r Hulu:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '' ) echo -n -e "\r Hulu:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r Hulu:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_encoreTVB() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r encoreTVB:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://edge.api.brightcove.com/playback/v1/accounts/5324042807001/videos/6005570109001' -H "Accept: application/json;pk=BCpkADawqM2Gpjj8SlY2mj4FgJJMfUpxTNtHWXOItY1PvamzxGstJbsgc-zFOHkCVcKeeOhPUd9MNHEGJoVy1By1Hrlh9rOXArC5M5MTcChJGU6maC8qhQ4Y8W-QYtvi8Nq34bUb9IOvoKBLeNF4D9Avskfe9rtMoEjj6ImXu_i4oIhYS0dx7x1AgHvtAaZFFhq3LBGtR-ZcsSqxNzVg-4PRUI9zcytQkk_YJXndNSfhVdmYmnxkgx1XXisGv1FG5GOmEK4jZ_Ih0riX5icFnHrgniADr4bA2G7TYh4OeGBrYLyFN_BDOvq3nFGrXVWrTLhaYyjxOr4rZqJPKK2ybmMsq466Ke1ZtE-wNQ" -H "Origin: https://www.encoretvb.com" -H 'accept-language: en-US,en;q=0.9' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r encoreTVB:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"error_subcode"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        'CLIENT_GEO') echo -n -e "\r encoreTVB:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '') echo -n -e "\r encoreTVB:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r encoreTVB:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Molotov() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://fapi.molotov.tv/v1/open-europe/is-france' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Molotov:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"is_france"\s{0,}:\s{0,}\K(false|true)')

    case "$result" in
        'false') echo -n -e "\r Molotov:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'true') echo -n -e "\r Molotov:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '') echo -n -e "\r Molotov:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r Molotov:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_LineTVTW() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r LineTV.TW:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.linetv.tw/' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r LineTV.TW:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    # 找 main js 的链接
    local mainJsUrl=$(echo "$tmpresult" | grep -woP 'src="\K[^"]+' | grep -E '/main-[a-z0-9]{8}')
    # 下载 main js
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s "${mainJsUrl}" -H 'referer: https://www.linetv.tw/' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r LineTV.TW:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi
    # 从 main js 里找 appId
    local appId=$(echo "$tmpresult2" | grep -woP 'appId:"\K[^"]+' | head -n 1)
    # 正式测试
    local tmpresult3=$(curl ${CURL_DEFAULT_OPTS} -s "https://www.linetv.tw/api/part/11829/eps/1/part?appId=${appId}&productType=FAST&version=10.38.0" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult3" ]; then
        echo -n -e "\r LineTV.TW:\t\t\t\t${Font_Red}Failed (Network Connection 2)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult3" | grep -woP '"countryCode"\s{0,}:\s{0,}\K\d+')
    case "$result" in
        '228') echo -n -e "\r LineTV.TW:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '') echo -n -e "\r LineTV.TW:\t\t\t\t${Font_Red}Failed (Error: Country Code Not Found)${Font_Suffix}\n" ;;
        *) echo -n -e "\r LineTV.TW:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_ViuCom() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Viu.com:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.viu.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Viu.com:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local region=$(echo "$urlEffective" | cut -f5 -d'/' | tr a-z A-Z)
    if [ -z "$region" ]; then
        echo -n -e "\r Viu.com:\t\t\t\t${Font_Red}Failed (Error: Country Code Not Found)${Font_Suffix}\n"
        return
    fi
    if [ "$region" == 'NO-SERVICE' ]; then
        echo -n -e "\r Viu.com:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Viu.com:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Viu.com:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_Niconico() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.nicovideo.jp/watch/so23017073' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    # 获取直播网页
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://live.nicovideo.jp/?cmnhd_ref=device=pc&site=nicolive&pos=header_servicelink&ref=WatchPage-Anchor' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    # 从直播网页中找到第一个官方直播剧
    # echo "$tmpresult2" | grep -woP 'id="DAT-csr-data" data-value="[^"]+' | sed 's/id="DAT-csr-data" data-value="//;s/&quot;/"/g' | \
    # jq -r '.props.view.popularBeforeOpenBroadcastStatusProgramListSectionState.programList.[] | select(.isOfficialChannelMemberFree == false) | .id' | head -n 1
    local liveID=$(echo "$tmpresult2" | sed 's/&quot;isOfficialChannelMemberFree&quot;:false/&quot;isOfficialChannelMemberFree&quot;:false\r\n/g' | grep -v '&quot;isOfficialChannelMemberFree&quot;:true' | grep -v -E 'playerProgram|&quot;ON_AIR&quot;' | grep '話' | grep -woP '&quot;id&quot;:&quot;\Klv[0-9]+' | head -n 1)
    if [ -z "$liveID" ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local tmpresult3=$(curl ${CURL_DEFAULT_OPTS} -sL "https://live.nicovideo.jp/watch/${liveID}" -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult3" ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Red}Failed (Network Connection 2)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep '同じ地域')
    local isJapanOnly=$(echo "$tmpresult3" | grep 'notAllowedCountry')

    if [ -z "$isBlocked" ] && [ -z "$isJapanOnly" ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Green}Yes (LiveID: $liveID)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    if [ -n "$isJapanOnly" ]; then
        echo -n -e "\r Niconico:\t\t\t\t${Font_Yellow}No (Official Live Unavailable. LiveID: ${liveID})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Niconico:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_ParamountPlus() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.paramountplus.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Paramount+:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local region=$(echo "$urlEffective" | cut -f4 -d'/' | tr a-z A-Z)

    if [ "$region" == 'INTL' ]; then
        echo -n -e "\r Paramount+:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        if [ -z "$region" ]; then
            local region='US'
        fi
        echo -n -e "\r Paramount+:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Paramount+:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_KKTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r KKTV:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.kktv.me/v3/ipcheck' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r KKTV:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    result=$(echo "$tmpresult" | grep -woP '"country"\s{0,}:\s{0,}"\K[^"]+')
    if [ "$result" == 'TW' ]; then
        echo -n -e "\r KKTV:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r KKTV:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_PeacockTV() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.peacocktv.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Peacock TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local result=$(echo "$urlEffective" | grep -i 'unavailable')

    if [ -n "$result" ]; then
        echo -n -e "\r Peacock TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Peacock TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Peacock TV:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_FOD() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r FOD(Fuji TV):\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://geocontrol1.stream.ne.jp/fod-geo/check.xml?time=1624504256' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r FOD(Fuji TV):\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '<FLAG\sTYPE="\K[^"]+')
    case "$result" in
        'true') echo -n -e "\r FOD(Fuji TV):\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        'false') echo -n -e "\r FOD(Fuji TV):\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '') echo -n -e "\r FOD(Fuji TV):\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r FOD(Fuji TV):\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_YouTube_Premium() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.youtube.com/premium' -H 'accept-language: en-US,en;q=0.9' -H 'cookie: YSC=FSCWhKo2Zgw; VISITOR_PRIVACY_METADATA=CgJERRIEEgAgYQ%3D%3D; PREF=f7=4000; __Secure-YEC=CgtRWTBGTFExeV9Iayjele2yBjIKCgJERRIEEgAgYQ%3D%3D; SOCS=CAISOAgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNTI2LjAxX3AwGgV6aC1DTiACGgYIgMnpsgY; VISITOR_INFO1_LIVE=Di84mAIbgKY; __Secure-BUCKET=CGQ' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r YouTube Premium:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isCN=$(echo "$tmpresult" | grep 'www.google.cn')

    if [ -n "$isCN" ]; then
        echo -n -e "\r YouTube Premium:\t\t\t${Font_Red}No${Font_Suffix} ${Font_Green} (Region: CN)${Font_Suffix} \n"
        return
    fi

    local isNotAvailable=$(echo "$tmpresult" | grep -i 'Premium is not available in your country')
    local region=$(echo "$tmpresult" | grep -woP '"INNERTUBE_CONTEXT_GL"\s{0,}:\s{0,}"\K[^"]+')
    local isAvailable=$(echo "$tmpresult" | grep -i 'ad-free')

    if [ -n "$isNotAvailable" ]; then
        echo -n -e "\r YouTube Premium:\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -z "$region" ]; then
        local region='UNKNOWN'
    fi
    if [ -n "$isAvailable" ]; then
        echo -n -e "\r YouTube Premium:\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r YouTube Premium:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
}

function WebTest_GooglePlayStore() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://play.google.com/'   -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'   -H 'accept-language: en-US;q=0.9'   -H 'priority: u=0, i'   -H 'sec-ch-ua: "Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"'   -H 'sec-ch-ua-mobile: ?0'   -H 'sec-ch-ua-platform: "Windows"'   -H 'sec-fetch-dest: document'   -H 'sec-fetch-mode: navigate'   -H 'sec-fetch-site: none'   -H 'sec-fetch-user: ?1'   -H 'upgrade-insecure-requests: 1' -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' | grep -oP '<div class="yVZQTb">\K[^<(]+')
    if [ -z "$result" ]; then
        echo -n -e "\r Google Play Store:\t\t\t${Font_Red}Failed${Font_Suffix}\n"
        return
    else
        echo -n -e "\r Google Play Store:\t\t\t${Font_Green}${result}${Font_Suffix}\n"
        return
    fi
}

function RegionTest_Apple() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://gspe1-ssl.ls.apple.com/pep/gcc')
    if [ -z "$result" ]; then
        echo -n -e "\r Apple Region:\t\t\t\t${Font_Red}Failed${Font_Suffix}\n"
        return
    else
        echo -n -e "\r Apple Region:\t\t\t\t${Font_Green}${result}${Font_Suffix}\n"
        return
    fi
}

function RegionTest_YouTubeCDN() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://redirector.googlevideo.com/report_mapping' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r YouTube CDN:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local iata=$(echo "$tmpresult" | grep '=>' | awk "NR==1" | awk '{print $3}' | cut -f2 -d'-' | cut -c 1-3 | tr a-z A-Z)
    local isIDC=$(echo "$tmpresult" | grep 'router')
    local isIataFound1=$(echo "$IATACODE" | grep -w "$iata")
    local isIataFound2=$(echo "$IATACODE2" | grep -w "$iata")

    if [ -z "$iata" ]; then
        echo -n -e "\r YouTube CDN:\t\t\t\t${Font_Red}Failed (Error: Location Unknown)${Font_Suffix}\n"
        return
    fi
    if [ -z "$isIataFound1" ] && [ -z "$isIataFound2" ]; then
        echo -n -e "\r YouTube CDN:\t\t\t\t${Font_Red}Failed (Error: IATA: ${iata} Not Found)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isIataFound1" ]; then
        local location=$(echo "$IATACODE" | grep -w "$iata" | awk -F'|' '{print $1}' | awk '{$1=$1; print}')
    fi
    if [ -z "$isIataFound1" ] && [ -n "$isIataFound2" ]; then
        local location=$(echo "$IATACODE2" | grep -w "$iata" | awk -F',' '{print $2}' | awk '{$1=$1; print}' | tr A-Z a-z | sed 's/\b[a-z]/\U&/g')
    fi

    if [ -z "$isIDC" ]; then
        local cdnISP=$(echo "$tmpresult" | awk 'NR==1' | awk '{print $3}' | cut -f1 -d'-' | tr a-z A-Z)
        echo -n -e "\r YouTube CDN:\t\t\t\t${Font_Yellow}[${cdnISP}] in [${location}]${Font_Suffix}\n"
        return
    fi
    if [ -n "$isIDC" ]; then
        echo -n -e "\r YouTube CDN:\t\t\t\t${Font_Green}${location}${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r YouTube CDN:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function WebTest_GoogleSearchCAPTCHA() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.google.com/search?q=curl&oq=curl&gs_lcrp=EgZjaHJvbWUyBggAEEUYOdIBBzg1MmowajGoAgCwAgE&sourceid=chrome&ie=UTF-8' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-model: ""' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-ch-ua-platform-version: "15.0.0"' -H 'sec-ch-ua-wow64: ?0' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Google Search CAPTCHA Free:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -iE 'unusual traffic from|is blocked|unaddressed abuse')
    local isOK=$(echo "$tmpresult" | grep -i 'curl')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Google Search CAPTCHA Free:\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Google Search CAPTCHA Free:\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Google Search CAPTCHA Free:\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Google Search CAPTCHA Free:\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_BritBox() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.britbox.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r BritBox:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local result=$(echo "$urlEffective" | grep -E 'locationnotsupported|locationnotvalidated|britbox.co.uk')

    if [ -n "$result" ]; then
        echo -n -e "\r BritBox:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r BritBox:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r BritBox:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_PrimeVideo() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Amazon Prime Video:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.primevideo.com' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Amazon Prime Video:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'isServiceRestricted')
    local region=$(echo "$tmpresult" | grep -woP '"currentTerritory":"\K[^"]+' | head -n 1)

    if [ -z "$isBlocked" ] && [ -z "$region" ]; then
        echo -n -e "\r Amazon Prime Video:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Amazon Prime Video:\t\t\t${Font_Red}No (Service Not Available)${Font_Suffix}\n"
        return
    fi
    if [ -n "$region" ]; then
        echo -n -e "\r Amazon Prime Video:\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Amazon Prime Video:\t\t\t${Font_Red}Failed (Error: Unknown Region)${Font_Suffix}\n"
}

function MediaUnlockTest_Radiko() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Radiko:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://radiko.jp/area?_=1625406539531' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Radiko:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep 'class="OUT"')
    local isOK=$(echo "$tmpresult" | grep -i 'JAPAN')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Radiko:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Radiko:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        local area=$(echo "$tmpresult" | awk '{print $2}' | sed 's/.*>//')
        echo -n -e "\r Radiko:\t\t\t\t${Font_Green}Yes (City: $area)${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Radiko:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_DMM() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r DMM:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://bitcoin.dmm.com/' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' --user-agent "${UA_BROWSER}")
    if [ -z  "$tmpresult" ]; then
        echo -n -e "\r DMM:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep 'This page is not available in your area')
    local isOK=$(echo "$tmpresult" | grep '暗号資産')


    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r DMM:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r DMM:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r DMM:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r DMM:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_DMMTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r DMM TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.beacon.dmm.com/v1/streaming/start' -X POST -d '{"player_name":"dmmtv_browser","player_version":"0.0.0","content_type_detail":"VOD_SVOD","content_id":"11uvjcm4fw2wdu7drtd1epnvz","purchase_product_id":null}' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r DMM TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep 'FOREIGN')
    local isOK=$(echo "$tmpresult" | grep 'UNAUTHORIZED')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r DMM TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r DMM TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r DMM TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r DMM TV:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Catchplay() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r CatchPlay+:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://sunapi.catchplay.com/geo' -H "authorization: Basic NTQ3MzM0NDgtYTU3Yi00MjU2LWE4MTEtMzdlYzNkNjJmM2E0Ok90QzR3elJRR2hLQ01sSDc2VEoy" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r CatchPlay+:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult"  | grep -woP '"code"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$result" ]; then
        echo -n -e "\r CatchPlay+:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    case "$result" in
        '0') echo -n -e "\r CatchPlay+:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '100016') echo -n -e "\r CatchPlay+:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Now E:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_HotStar() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sLi 'https://www.hotstar.com' -w '\n_TAG_%{http_code}_TAG_%{url_effective}_TAG_\n' --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | grep -o '_TAG_.*_TAG_' | awk -F'_TAG_' '{print $2}')

    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r HotStar:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r HotStar:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '475' ]; then
        echo -n -e "\r HotStar:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | grep -o '_TAG_.*_TAG_' | awk -F'_TAG_' '{print $3}')
    local region=$(echo "$tmpresult" | grep -woP 'geo=\K[A-Z]+' | head -n 1)
    local siteRegion=$(echo "$urlEffective" | sed 's@.*com/@@' | tr a-z A-Z)

    if [ -z "$region" ]; then
        echo -n -e "\r HotStar:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if  [ "$region" == 'US' ]; then
        echo -n -e "\r HotStar:\t\t\t\t${Font_Yellow}No (Discontinued in the US)${Font_Suffix}\n"
        return
    fi
    if  [ "$region" == "$siteRegion" ]; then
        echo -n -e "\r HotStar:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r HotStar:\t\t\t\t${Font_Red}Failed (Error: REGION ERROR ${region}_${siteRegion})${Font_Suffix}\n"
}

function MediaUnlockTest_LiTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r LiTV:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local fakePUid=$(gen_uuid)
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.litv.tv/api/get-urls-no-auth' -H 'accept: application/json, text/plain, */*' -H 'content-type: application/json' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.litv.tv' -H 'referer: https://www.litv.tv/drama/watch/VOD00328856' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-origin' --data-raw "{\"AssetId\":\"vod70810-000001M001_1500K\",\"MediaType\":\"vod\",\"puid\":\"${fakePUid}\"}" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r LiTV:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isOK=$(echo "$tmpresult" | grep 'AssetURLs')
    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[^"][0-9]{0,}')

    if [ -n "$isOK" ]; then
        echo -n -e "\r LiTV:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    case "$result" in
        '42000087') echo -n -e "\r LiTV:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '42000075') echo -n -e "\r LiTV:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;; # 剧集不存在
        '') echo -n -e "\r LiTV:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r LiTV:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_FuboTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Fubo TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fs "https://api.fubo.tv/v3/location" -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.fubo.tv' -H 'referer: https://www.fubo.tv/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Fubo TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local noService=$(echo "$tmpresult" | grep -i 'NO_SERVICE_IN_COUNTRY')
    local isAllowed=$(echo "$tmpresult" | grep -o '"network_allowed":true')
    local isBlocked=$(echo "$tmpresult" | grep -o '"network_allowed":false')
    local countryCode=$(echo "$tmpresult" | grep -oP '"country_code2":"\K[^"]+')

    if [ -n "$noService" ]; then
        echo -n -e "\r Fubo TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Fubo TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isAllowed" ]; then
        echo -n -e "\r Fubo TV:\t\t\t\t${Font_Green}Yes (Region:${countryCode})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Fubo TV:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Fox() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://x-live-fox-stgec.uplynk.com/ausw/slices/8d1/d8e6eec26bf544f084bad49a7fa2eac5/8d1de292bcc943a6b886d029e6c0dc87/G00000000.ts?pbs=c61e60ee63ce43359679fb9f65d21564&cloud=aws&si=0' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r FOX:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r FOX:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r FOX:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r FOX:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Joyn() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Joyn:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpauth=$(curl ${CURL_DEFAULT_OPTS} -s 'https://auth.joyn.de/auth/anonymous' -X POST -H "Content-Type: application/json" -d '{"client_id":"b74b9f27-a994-4c45-b7eb-5b81b1c856e7","client_name":"web","anon_device_id":"b74b9f27-a994-4c45-b7eb-5b81b1c856e7"}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpauth" ]; then
        echo -n -e "\r Joyn:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local auth=$(echo "$tmpauth" | grep -woP '"access_token"\s{0,}:\s{0,}"\K[^"]+')
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.joyn.de/content/entitlement-token' -H "x-api-key: 36lp1t4wto5uu2i2nk57ywy9on1ns5yg" -H "content-type: application/json" -d '{"content_id":"daserste-de-hd","content_type":"LIVE"}' -H "authorization: Bearer ${auth}" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Joyn:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local isOK=$(echo "$tmpresult" | grep -i 'entitlement_token')
    local isBlocked=$(echo "$tmpresult" | grep -i 'ENT_AssetNotAvailableInCountry')

    if [ -z "$isOK" ] && [ -z "$isBlocked" ]; then
        echo -n -e "\r Joyn:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Joyn:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Joyn:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Joyn:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_SpotvNow() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r SPOTV NOW:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://edge.api.brightcove.com/playback/v1/accounts/5764318566001/videos/6349973203112' -H 'accept: application/json;pk=BCpkADawqM0U3mi_PT566m5lvtapzMq3Uy7ICGGjGB6v4Ske7ZX_ynzj8ePedQJhH36nym_5mbvSYeyyHOOdUsZovyg2XlhV6rRspyYPw_USVNLaR0fB_AAL2HSQlfuetIPiEzbUs1tpNF9NtQxt3BAPvXdOAsvy1ltLPWMVzJHiw9slpLRgI2NUufc' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.spotvnow.co.kr' -H 'referer: https://www.spotvnow.co.kr/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r SPOTV NOW:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"error_subcode"\s{0,}:\s{0,}"\K[^"]+')

    case "$result" in
        'CLIENT_GEO') echo -n -e "\r SPOTV NOW:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '') echo -n -e "\r SPOTV NOW:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r SPOTV NOW:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_SKY_DE() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r SKY DE:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://edge.api.brightcove.com/playback/v1/accounts/1050888051001/videos/6247131490001' -H "Accept: application/json;pk=BCpkADawqM0OXCLe4eIkpyuir8Ssf3kIQAM62a1KMa4-1_vTOWQIxoHHD4-oL-dPmlp-rLoS-WIAcaAMKuZVMR57QY4uLAmP4Ov3V416hHbqr0GNNtzVXamJ6d4-rA3Xi98W-8wtypdEyjGEZNepUCt3D7UdMthbsG-Ean3V4cafT4nZX03st5HlyK1chp51SfA-vKcAOhHZ4_Oa9TTN61tEH6YqML9PWGyKrbuN5myICcGsFzP3R2aOF8c5rPCHT2ZAiG7MoavHx8WMjhfB0QdBr2fphX24CSpUKlcjEnQJnBiA1AdLg9iyReWrAdQylX4Eyhw5OwKiCGJznfgY6BDtbUmeq1I9r9RfmhP5bfxVGjILSEFZgXbMqGOvYdrdare0aW2fTCxeHdHt0vyKOWTC6CS1lrGJF2sFPKn1T1csjVR8s4MODqCBY1PTbHY4A9aZ-2MDJUVJDkOK52hGej6aXE5b9N9_xOT2B9wbXL1B1ZB4JLjeAdBuVtaUOJ44N0aCd8Ns0o02E1APxucQqrjnEociLFNB0Bobe1nkGt3PS74IQcs-eBvWYSpolldMH6TKLu8JqgdnM4WIp3FZtTWJRADgAmvF9tVDUG9pcJoRx_CZ4im-rn-AzN3FeOQrM4rTlU3Q8YhSmyEIoxYYqsFDwbFlhsAcvqQkgaElYtuciCL5i3U8N4W9rIhPhQJzsPafmLdWxBP_FXicyek25GHFdQzCiT8nf1o860Jv2cHQ4xUNcnP-9blIkLy9JmuB2RgUXOHzWsrLGGW6hq9wLUtqwEoxcEAAcNJgmoC0k8HE-Ga-NHXng6EFWnqiOg_mZ_MDd7gmHrrKLkQV" -H "Origin: https://www.sky.de" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r SKY DE:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"error_subcode"\s{0,}:\s{0,}"\K[^"]+')

    case "$result" in
        'CLIENT_GEO') echo -n -e "\r SKY DE:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '') echo -n -e "\r SKY DE:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r SKY DE:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_ZDF() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r ZDF: \t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://ssl.zdf.de/geo/de/geo.txt/' -w %{http_code} -o /dev/null --user-agent "${UA_ANDROID}")

    case "$result" in
        '000') echo -n -e "\r ZDF: \t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '404') echo -n -e "\r ZDF: \t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r ZDF: \t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r ZDF: \t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_HBOGO_ASIA() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r HBO GO Asia:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api2.hbogoasia.com/v1/geog?lang=undefined&version=0&bundleId=www.hbogoasia.com' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r HBO GO Asia:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"territory"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$result" ]; then
        echo -n -e "\r HBO GO Asia:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP '"country"\s{0,}:\s{0,}"\K[^"]+')
    if [ -n "$region" ]; then
        echo -n -e "\r HBO GO Asia:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r HBO GO Asia:\t\t\t\t${Font_Red}Failed (Error: Country Code Not Found)${Font_Suffix}\n"
}

function MediaUnlockTest_EPIX() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r MGM+:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpToken=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.epix.com/v2/sessions' -X POST -H 'host: api.epix.com' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'traceparent: 00-000000000000000015b7efdb572b7bf2-4aefaea90903bd1f-01' -H 'sec-ch-ua-mobile: ?0' -H 'x-datadog-origin: rum' -H 'x-datadog-sampling-priority: 1' -H 'accept: application/json' -H 'x-datadog-trace-id: 1564983120873880562' -H 'x-datadog-parent-id: 5399726519264460063' -H 'sec-ch-ua-platform: "Windows"' -H 'origin: https://www.mgmplus.com' -H 'sec-fetch-site: cross-site' -H 'sec-fetch-mode: cors' -H 'sec-fetch-dest: empty' -H 'referer: https://www.mgmplus.com/' -H 'accept-language: en-US,en;q=0.9' -H 'content-type: application/json' -d '{"device":{"guid":"7a0baaaf-384c-45cd-a21d-310ca5d3002a","format":"console","os":"web","display_width":1865,"display_height":942,"app_version":"1.0.2","model":"browser","manufacturer":"google"},"apikey":"53e208a9bbaee479903f43b39d7301f7"}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpToken" ]; then
        echo -n -e "\r MGM+:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local is403=$(echo "$tmpToken" | grep -i '403 ERROR')
    if [ -n "$is403" ]; then
        echo -n -e "\r MGM+:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local epixToken=$(echo "$tmpToken" | grep -woP '"session_token"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$epixToken" ]; then
        echo -n -e "\r MGM+:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.epix.com/graphql' -X POST -H 'host: api.epix.com' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'traceparent: 00-0000000000000000603047c112148412-32d64f8c890631ef-01' -H 'sec-ch-ua-mobile: ?0' -H 'x-datadog-origin: rum' -H 'x-datadog-sampling-priority: 1' -H 'accept: application/json' -H "x-session-token: ${epixToken}" -H 'x-datadog-trace-id: 6931118721080787986' -H 'x-datadog-parent-id: 3663202811925377519' -H 'sec-ch-ua-platform: "Windows"' -H 'origin: https://www.mgmplus.com' -H 'sec-fetch-site: cross-site' -H 'sec-fetch-mode: cors' -H 'sec-fetch-dest: empty' -H 'referer: https://www.mgmplus.com/' -H 'accept-language: en-US,en;q=0.9' -H 'content-type: application/json' -d '{"operationName":"PlayFlow","variables":{"id":"c2VyaWVzOzEwMTc=","supportedActions":["open_url","show_notice","start_billing","play_content","log_in","noop","confirm_provider","unlinked_provider"],"streamTypes":[{"encryptionScheme":"CBCS","packagingSystem":"DASH"},{"encryptionScheme":"CENC","packagingSystem":"DASH"},{"encryptionScheme":"NONE","packagingSystem":"HLS"},{"encryptionScheme":"SAMPLE_AES","packagingSystem":"HLS"}]},"query":"fragment ShowNotice on ShowNotice {\n  type\n  actions {\n    continuationContext\n    text\n    __typename\n  }\n  description\n  title\n  __typename\n}\n\nfragment OpenUrl on OpenUrl {\n  type\n  url\n  __typename\n}\n\nfragment Content on Content {\n  title\n  __typename\n}\n\nfragment Movie on Movie {\n  id\n  shortName\n  __typename\n}\n\nfragment Episode on Episode {\n  id\n  series {\n    shortName\n    __typename\n  }\n  seasonNumber\n  number\n  __typename\n}\n\nfragment Preroll on Preroll {\n  id\n  __typename\n}\n\nfragment ContentUnion on ContentUnion {\n  ...Content\n  ...Movie\n  ...Episode\n  ...Preroll\n  __typename\n}\n\nfragment PlayContent on PlayContent {\n  type\n  continuationContext\n  heartbeatToken\n  currentItem {\n    content {\n      ...ContentUnion\n      __typename\n    }\n    __typename\n  }\n  nextItem {\n    content {\n      ...ContentUnion\n      __typename\n    }\n    showNotice {\n      ...ShowNotice\n      __typename\n    }\n    showNoticeAt\n    __typename\n  }\n  amazonPlaybackData {\n    pid\n    playbackToken\n    materialType\n    __typename\n  }\n  playheadPosition\n  vizbeeStreamInfo {\n    customStreamInfo\n    __typename\n  }\n  closedCaptions {\n    ttml {\n      location\n      __typename\n    }\n    vtt {\n      location\n      __typename\n    }\n    xml {\n      location\n      __typename\n    }\n    __typename\n  }\n  hints {\n    duration\n    seekAllowed\n    trackingEnabled\n    trackingId\n    __typename\n  }\n  streams(types: $streamTypes) {\n    playlistUrl\n    closedCaptionsEmbedded\n    packagingSystem\n    encryptionScheme\n    videoQuality {\n      height\n      width\n      __typename\n    }\n    widevine {\n      authenticationToken\n      licenseServerUrl\n      __typename\n    }\n    playready {\n      authenticationToken\n      licenseServerUrl\n      __typename\n    }\n    fairplay {\n      authenticationToken\n      certificateUrl\n      licenseServerUrl\n      __typename\n    }\n    __typename\n  }\n  __typename\n}\n\nfragment StartBilling on StartBilling {\n  type\n  __typename\n}\n\nfragment LogIn on LogIn {\n  type\n  __typename\n}\n\nfragment Noop on Noop {\n  type\n  __typename\n}\n\nfragment PreviewContent on PreviewContent {\n  type\n  title\n  description\n  stream {\n    sources {\n      hls {\n        location\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n  __typename\n}\n\nfragment ConfirmProvider on ConfirmProvider {\n  type\n  __typename\n}\n\nfragment UnlinkedProvider on UnlinkedProvider {\n  type\n  __typename\n}\n\nquery PlayFlow($id: String!, $supportedActions: [PlayFlowActionEnum!]!, $context: String, $behavior: BehaviorEnum = DEFAULT, $streamTypes: [StreamDefinition!]) {\n  playFlow(\n    id: $id\n    supportedActions: $supportedActions\n    context: $context\n    behavior: $behavior\n  ) {\n    ...ShowNotice\n    ...OpenUrl\n    ...PlayContent\n    ...StartBilling\n    ...LogIn\n    ...Noop\n    ...PreviewContent\n    ...ConfirmProvider\n    ...UnlinkedProvider\n    __typename\n  }\n}"}' --user-agent "${UA_BROWSER}")

    local isBlocked=$(echo "$tmpresult" | grep -i 'MGM+ is only available in the United States')
    local isOK=$(echo "$tmpresult" | grep -i 'StartBilling')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r MGM+:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r MGM+:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r MGM+:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r MGM+:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_NLZIET() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r NLZIET:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.nlziet.nl/v7/stream/handshake/Widevine/Dash/VOD/rzIL9rb-TkSn-ek_wBmvaw?playerName=BitmovinWeb' -H 'accept: application/json, text/plain, */*' -H 'accept-language: en-US,en;q=0.9' -H 'authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IkM4M0YzQUFGOTRCOTM0ODA2NkQwRjZDRTNEODhGQkREIiwidHlwIjoiYXQrand0In0.eyJuYmYiOjE3MTIxMjY0NTMsImV4cCI6MTcxMjE1NTI0OCwiaXNzIjoiaHR0cHM6Ly9pZC5ubHppZXQubmwiLCJhdWQiOiJhcGkiLCJjbGllbnRfaWQiOiJ0cmlwbGUtd2ViIiwic3ViIjoiMDAzMTZiNGEtMDAwMC0wMDAwLWNhZmUtZjFkZTA1ZGVlZmVlIiwiYXV0aF90aW1lIjoxNzEyMTI2NDUzLCJpZHAiOiJsb2NhbCIsImVtYWlsIjoibXVsdGkuZG5zMUBvdXRsb29rLmNvbSIsInVzZXJJZCI6IjMyMzg3MzAiLCJjdXN0b21lcklkIjoiMCIsImRldmljZUlkZW50aWZpZXIiOiJJZGVudGl6aWV0LTI0NWJiNmYzLWM2ZjktNDNjZS05ODhmLTgxNDc2OTcwM2E5OCIsImV4dGVybmFsVXNlcklkIjoiZTM1ZjdkMzktMjQ0ZC00ZTkzLWFkOTItNGFjYzVjNGY0NGNlIiwicHJvZmlsZUlkIjoiMjdDMzM3RjktOTRDRS00NjBDLTlBNjktMTlDNjlCRTYwQUIzIiwicHJvZmlsZUNvbG9yIjoiRkY0MjdDIiwicHJvZmlsZVR5cGUiOiJBZHVsdCIsIm5hbWUiOiJTdHJlYW1pbmciLCJqdGkiOiI4Q0M1QzYzNkJGRjg3MEE2REJBOERBNUMwQTk0RUZDRiIsImlhdCI6MTcxMjEyNjQ1Mywic2NvcGUiOlsiYXBpIiwib3BlbmlkIl0sImFtciI6WyJwcm9maWxlIiwicHdkIl19.bk-ziFPJM00bpE7TcgPmIYFFx-2Q5N3BkUzEvQ_dDMK9O1F9f7DEe-Qzmnb5ym7ChlnXwrCV3QyOOA24hu_gCrlNlD7-vI3XGZR-54zFD-F7cRDOoL-1-iO_10tmgwb5Io-svY0bn0EDYKeRxYYBi0w_3bFVFDM2CxxA6tWeBYIfN5rCSzBHd3RPPjYtqX-sogyh_5W_7KJ83GK5kpsywT3mz8q7Cs1mtKs9QA1-o01N0RvTxZAcfzsHg3-qGgLnvaAuZ_XqRK9kLWqJWeJTWKWtUI6OlPex22sY3keKFpfZnUtFv-BvkCM6tvbIlMZAClk3lhI8rMFAWDpUcbcS3w' -H 'nlziet-appname: WebApp' -H 'nlziet-appversion: 5.43.24' -H 'origin: https://app.nlziet.nl' -H 'referer: https://app.nlziet.nl/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r NLZIET:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'CountryNotAllowed')
    local isOK=$(echo "$tmpresult" | grep -i 'streamSessionId')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r NLZIET:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r NLZIET:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r NLZIET:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r NLZIET:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_videoland() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.videoland.com/subscribe/videoland-account/graphql' -X POST -H 'host: api.videoland.com' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'apollographql-client-name: apollo_accounts_base' -H 'traceparent: 00-cab2dbd109bf1e003903ec43eb4c067d-623ef8e56174b85a-01' -H 'sec-ch-ua-mobile: ?0' -H 'accept: */*' -H 'sec-ch-ua-platform: "Windows"' -H 'origin: https://www.videoland.com' -H 'sec-fetch-site: same-site' -H 'sec-fetch-mode: cors' -H 'sec-fetch-dest: empty' -H 'referer: https://www.videoland.com/' -H 'accept-language: en-US,en;q=0.9' -H 'content-type: application/json' -d '{"operationName":"IsOnboardingGeoBlocked","variables":{},"query":"query IsOnboardingGeoBlocked {\n  isOnboardingGeoBlocked\n}\n"}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r videoland:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"isOnboardingGeoBlocked"\s{0,}:\s{0,}\K(false|true)')
    case "$result" in
        'false') echo -n -e "\r videoland:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        'true') echo -n -e "\r videoland:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '') echo -n -e "\r videoland:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r videoland:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_NPO_Start_Plus() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.npo.nl/start/api/domain/player-token?productId=LI_NL1_4188102' -H 'host: www.npo.nl' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'accept: application/json, text/plain, */*' -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-site: same-origin' -H 'sec-fetch-mode: cors' -H 'sec-fetch-dest: empty' -H 'referer: https://www.npo.nl/start/live?channel=NPO1' -H 'accept-language: en-US,en;q=0.9' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r NPO Start Plus:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local token=$(echo "$tmpresult" | grep -woP '"token"\s{0,}:\s{0,}"\K[^"]+')
    local result=$(curl ${CURL_DEFAULT_OPTS} -s 'https://prod.npoplayer.nl/stream-link' -w %{http_code} -o /dev/null -H 'accept: */*' -H "authorization: ${token}" -H 'content-type: application/json' -H 'origin: https://npo.nl' -H 'referer: https://npo.nl/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' --data-raw '{"profileName":"dash","drmType":"playready","referrerUrl":"https://npo.nl/start/live?channel=NPO1"}' -H 'accept-language: en-US,en;q=0.9' --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r NPO Start Plus:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r NPO Start Plus:\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '451') echo -n -e "\r NPO Start Plus:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r NPO Start Plus:\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_RakutenTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Rakuten TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local fakeUuid=$(gen_uuid)
    local fakeIfaId=$(gen_uuid)
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://gizmo.rakuten.tv/v3/me/start?device_identifier=web&device_stream_audio_quality=2.0&device_stream_hdr_type=NONE&device_stream_video_quality=FHD' -H 'accept: application/json, text/plain, */*' -H 'accept-language: en-US,en;q=0.9' -H 'content-type: application/json' -H 'origin: https://www.rakuten.tv' -H 'referer: https://www.rakuten.tv/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --data-raw '{"device_identifier":"web","device_metadata":{"app_version":"v5.5.30","audio_quality":"2.0","brand":"chrome","firmware":"XX.XX.XX","hdr":false,"model":"GENERIC","os":"Windows 10","sdk":"125.0.0","serial_number":"not implemented","trusted_uid":false,"uid":"824b3fe9-e080-4c33-912b-3f67d96f5f99","video_quality":"FHD","year":1970},"ifa_id":"4ac8a156-b857-4335-96c1-fa8930430092"}' --user-agent "${UA_BROWSER}")

    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Rakuten TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -iE 'VPN|forbidden|is not available')
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Rakuten TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP '"iso3166_code"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$region" ]; then
        echo -n -e "\r Rakuten TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local isOK=$(echo "$tmpresult" | grep -i 'streaming_drm_types')
    if [ -n "$isOK" ]; then
        echo -n -e "\r Rakuten TV:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Rakuten TV:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_MoviStarPlus() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Movistar+:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -s 'https://contratar.movistarplus.es/' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Movistar+:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Movistar+:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Movistar+:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Movistar+:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Starz() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Starz:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local authorization=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.starz.com/sapi/header/v1/starz/us/09b397fc9eb64d5080687fc8a218775b' -H "Referer: https://www.starz.com/us/en/" --user-agent "${UA_BROWSER}")
    if [ -z "$authorization" ]; then
        echo -n -e "\r Starz:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://auth.starz.com/api/v4/User/geolocation' -H "AuthTokenAuthorization: $authorization")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Starz:\t\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local isAllowedAccess=$(echo "$tmpresult" | grep -woP '"isAllowedAccess"\s{0,}:\s{0,}\K(false|true)')
    local isAllowedCountry=$(echo "$tmpresult" | grep -woP '"isAllowedCountry"\s{0,}:\s{0,}\K(false|true)')
    local isKnownProxy=$(echo "$tmpresult" | grep -woP '"isKnownProxy"\s{0,}:\s{0,}\K(false|true)')

    if [ -z "$isAllowedAccess" ] || [ -z "$isAllowedCountry" ] || [ -z "$isKnownProxy" ]; then
        echo -n -e "\r Starz:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$isAllowedAccess" == 'true' ] && [ "$isAllowedCountry" == 'true' ] && [ "$isKnownProxy" == 'false' ]; then
        echo -n -e "\r Starz:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi
    if [ "$isAllowedAccess" == 'false' ]; then
        echo -n -e "\r Starz:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$isKnownProxy" == 'false' ]; then
        echo -n -e "\r Starz:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Starz:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_CanalPlus() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Canal+:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://boutique-tunnel.canalplus.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Canal+:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local result=$(echo "$urlEffective" | grep -i 'other-country-blocking')
    if [ -n "$result" ]; then
        echo -n -e "\r Canal+:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Canal+:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Canal+:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_Sky_CH() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://sky.ch/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r SKY CH:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r SKY CH:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local result=$(echo "$urlEffective" | grep -i 'out-of-country')
    if [ -n "$result" ]; then
        echo -n -e "\r SKY CH:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r SKY CH:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r SKY CH:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_CBCGem() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r CBC Gem:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.cbc.ca/g/stats/js/cbc-stats-top.js' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r CBC Gem:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"country"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "${result}" ]; then
        echo -n -e "\r CBC Gem:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$result" == 'CA' ]; then
        echo -n -e "\r CBC Gem:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r CBC Gem:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_AcornTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Acorn TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://acorn.tv/' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Acorn TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -iE 'not yet available in your|unavailable in your')
    local isOK=$(echo "$tmpresult" | grep -i 'signup.acorn.tv')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Acorn TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Acorn TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Acorn TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Acorn TV:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Crave() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Crave:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://capi.9c9media.com/destinations/crave_atexace/platforms/desktop/playback/contents/2917721/contentPackages/6642701/manifest.mpd?action=reference&ssl=true&filter=fe&mca=false&uhd=false&mcv=false&hd=true&tpt=true&mta=true&stt=true&multilang=true' -H 'Content-Type: application/json' -H 'Origin: https://www.crave.ca' -H 'Referer: https://www.crave.ca/' -H 'accept-language: en-US,en;q=0.9' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: cross-site'  -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Crave:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isOK=$(echo "$tmpresult" | grep -i 'video.9c9media.com')
    local isBlocked=$(echo "$tmpresult" | grep -i 'Geo Constraint Restrictions')

    if [ -z "$isOK" ] && [ -z "$isBlocked" ]; then
        echo -n -e "\r Crave:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Crave:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Crave:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Crave:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Amediateka() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Amediateka:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.amediateka.ru/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Amediateka:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local result=$(echo "$urlEffective" | grep -i 'unavailable')
    if [ -n "$result" ]; then
        echo -n -e "\r Amediateka:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '503' ]; then
        echo -n -e "\r Amediateka:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Amediateka:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Amediateka:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_MegogoTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Megogo TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://megogo.net/en' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Megogo TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local vpnDetected=$(echo "$tmpresult" | grep -i 'VPN')
    if [ -n "$vpnDetected" ]; then
        echo -n -e "\r Megogo TV:\t\t\t\t${Font_Red}No (VPN Detected)${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Megogo TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
}

function MediaUnlockTest_RaiPlay() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Rai Play:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://mediapolisvod.rai.it/relinker/relinkerServlet.htm?cont=VxXwi7UcqjApssSlashbjsAghviAeeqqEEqualeeqqEEqual&output=64' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Rai Play:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '<geoprotection>\K[^<]+')
    local isBlocked=$(echo "$tmpresult" | grep -i 'video_no_available')

    if [ -z "$result" ]; then
        echo -n -e "\r Rai Play:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Rai Play:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    case "$result" in
        'Y') echo -n -e "\r Rai Play:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        'N') echo -n -e "\r Rai Play:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Rai Play:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_TVBAnywhere() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r TVBAnywhere+:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://uapisfm.tvbanywhere.com.sg/geoip/check/platform/android' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r TVBAnywhere+:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"allow_in_this_country"\s{0,}:\s{0,}\K(false|true)')
    if [ -z "$result" ]; then
        echo -n -e "\r TVBAnywhere+:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    case "$result" in
        'true') echo -n -e "\r TVBAnywhere+:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        'false') echo -n -e "\r TVBAnywhere+:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r TVBAnywhere+:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n" ;;
    esac
}

function GameTest_ProjectSekai() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Project Sekai: Colorful Stage:\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://game-version.sekai.colorfulpalette.org/1.8.1/3ed70b6a-8352-4532-b819-108837926ff5' -w %{http_code} -o /dev/null -H "User-Agent: pjsekai/48 CFNetwork/1240.0.4 Darwin/20.6.0")

    case "$result" in
        '000') echo -n -e "\r Project Sekai: Colorful Stage:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Project Sekai: Colorful Stage:\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Project Sekai: Colorful Stage:\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Project Sekai: Colorful Stage:\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function GameTest_KonosubaFD() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Konosuba Fantastic Days:\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://api.konosubafd.jp/api/masterlist' -X POST -w %{http_code} -o /dev/null -H "User-Agent: pj0007/212 CFNetwork/1240.0.4 Darwin/20.6.0")

    case "$result" in
        '000') echo -n -e "\r Konosuba Fantastic Days:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Konosuba Fantastic Days:\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Konosuba Fantastic Days:\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Konosuba Fantastic Days:\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_NBATV() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.nba.com/watch/' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r NBA TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -i 'Service is not available in your region')

    if [ -z "$result" ]; then
        echo -n -e "\r NBA TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r NBA TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_Directv() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://stream.directv.com/watchnow' -w %{http_code} -o /dev/null -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Directv Stream:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Directv Stream:\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Directv Stream:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Directv Stream:\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function RegionTest_NetflixCDN() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.fast.com/netflix/speedtest/v2?https=true&token=YXNkZmFzZGxmbnNkYWZoYXNkZmhrYWxm&urlCount=1' -w '_TAG_%{http_code}' --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    local respContent=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (IP Banned By Netflix)${Font_Suffix}\n"
        return
    fi

    local cdnDomain=$(echo "$respContent" | grep -woP '"url":"\K[^"]+' | awk -F'[/:]' '{print $4}')
    if [ -z "$cdnDomain" ]; then
        echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "${USE_IPV6}" == 1 ]; then
        local cdnIP=$(resolve_ip_address "$cdnDomain" 'AAAA')
    else
        local cdnIP=$(resolve_ip_address "$cdnDomain" 'A')
    fi

    if [ -z "$cdnIP" ]; then
        echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (CDN IP Not Found)${Font_Suffix}\n"
        return
    fi

    if ! validate_intranet "$cdnIP"; then
        local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -s "https://api.ip.sb/geoip/${cdnIP}" -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
        if [ -z "$tmpresult1" ]; then
            echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
            return
        fi

        local cdnISP=$(echo "$tmpresult1" | grep -woP '"isp"\s{0,}:\s{0,}"\K[^"]+')
        if [ -z "$cdnISP" ]; then
            echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (Error: No ISP Info Found)${Font_Suffix}\n"
            return
        fi
    else
        cdnISP='Hidden by a VPN'
    fi

    local iata=$(echo "$cdnDomain" | cut -f3 -d'-' | sed 's/.\{3\}$//' | tr a-z A-Z)

    # local IATACODE2=$(curl ${CURL_DEFAULT_OPTS} -s "https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/IATACODE2.txt" 2>&1)
    local isIataFound1=$(echo "$IATACODE" | grep -w "$iata")
    local isIataFound2=$(echo "$IATACODE2" | grep -w "$iata")

    if [ -n "$isIataFound1" ]; then
        local location=$(echo "$IATACODE" | grep -w "$iata" | awk -F'|' '{print $1}' | awk '{$1=$1; print}')
    fi
    if [ -z "$isIataFound1" ] && [ -n "$isIataFound2" ]; then
        local location=$(echo "$IATACODE2" | grep -w "$iata" | awk -F',' '{print $2}' | awk '{$1=$1; print}' | tr A-Z a-z | sed 's/\b[a-z]/\U&/g')
    fi

    if [ -z "$location" ]; then
        echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (Error: IATA CODE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$cdnISP" == 'Netflix Streaming Services' ]; then
        echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Green}${location}${Font_Suffix}\n"
        return
    else
        echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Yellow}[${cdnISP}] in [${location}]${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Netflix Preferred CDN:\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_SkyGo() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Sky Go:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://skyid.sky.com/authorise/skygo?response_type=token&client_id=sky&appearance=compact&redirect_uri=skygo://auth' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Sky Go:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isSignIn=$(echo "$tmpresult" | grep -E "Sign in</h3>|skygoSignin")
    if [ -n "$isSignIn" ]; then
        echo -n -e "\r Sky Go:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -E "Access Denied.*You don't have permission to access")
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Sky Go:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Sky Go:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_DirecTVGO() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r DirecTV Go:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.directvgo.com/registrarse' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r DirecTV Go:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isForbidden=$(echo "$urlEffective" | grep 'proximamente')
    local region=$(echo "$urlEffective" | cut -f4 -d'/' | tr a-z A-Z)

    if [ -n "$isForbidden" ]; then
        echo -n -e "\r DirecTV Go:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r DirecTV Go:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r DirecTV Go:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r DirecTV Go:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_DAM() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Karaoke@DAM:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'http://cds1.clubdam.com/vhls-cds1/site/xbox/sample_1.mp4.m3u8' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Karaoke@DAM:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Karaoke@DAM:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Karaoke@DAM:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Karaoke@DAM:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_DiscoveryPlus() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    # 取得 API 网址
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://global-prod.disco-api.com/bootstrapInfo' -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.discoveryplus.com' -H 'referer: https://www.discoveryplus.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' -H 'x-disco-client: WEB:UNKNOWN:dplus_us:2.46.0' -H 'x-disco-params: bid=dplus,hn=www.discoveryplus.com' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local baseApiUrl=$(echo "$tmpresult" | grep -woP '"baseApiUrl"\s{0,}:\s{0,}"\K[^"]+')
    local realm=$(echo "$tmpresult" | grep -woP '"realm"\s{0,}:\s{0,}"\K[^"]+')

    if [ -z "$baseApiUrl" ] || [ -z "$realm" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$realm" == 'dplusapac' ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}No (Not Yet Available in Asia Pacific)${Font_Suffix}\n"
        return
    fi

    local fakeDeviceId=$(gen_uuid | md5sum | cut -f1 -d' ')

    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -s "${baseApiUrl}/token?deviceId=${fakeDeviceId}&realm=${realm}&shortlived=true" -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.discoveryplus.com' -H 'referer: https://www.discoveryplus.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H "x-device-info: dplus_us/2.46.0 (desktop/desktop; Windows/NT 10.0; ${fakeDeviceId})" -H 'x-disco-client: WEB:UNKNOWN:dplus_us:2.46.0' -H "x-disco-params: realm=${realm},bid=dplus,hn=www.discoveryplus.com,hth=,features=ar" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult1" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local token=$(echo "$tmpresult1" | grep -woP '"token"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$token" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR 1)${Font_Suffix}\n"
        return
    fi

    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s "${baseApiUrl}/cms/routes/tabbed-home?include=default&decorators=viewingHistory,isFavorite,playbackAllowed,contentAction" -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.discoveryplus.com' -H 'referer: https://www.discoveryplus.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H 'x-disco-client: WEB:UNKNOWN:dplus_us:2.46.0' -H 'x-disco-params: realm=dplay,bid=dplus,hn=www.discoveryplus.com,hth=,features=ar' -b "st=${token}" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}Failed (Network Connection 2)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult2" | grep -iE 'is unavailable in your|not yet available')
    local isOK=$(echo "$tmpresult2" | grep -i 'relationships')
    local region=$(echo "$tmpresult2" | grep -woP '"mainTerritoryCode"\s{0,}:\s{0,}"\K[^"]+' | tr a-z A-Z)

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR 2)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    if [ -n "$isOK" ]; then
        echo -n -e "\r Discovery+:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Discovery+:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_ESPNPlus() {
    local espnCookies=$(echo "$MEDIA_COOKIE" | sed -n '11p')
    local tokenContent=$(curl ${CURL_DEFAULT_OPTS} -s 'https://espn.api.edge.bamgrid.com/token' -X POST -H "authorization: Bearer ZXNwbiZicm93c2VyJjEuMC4w.ptUt7QxsteaRruuPmGZFaJByOoqKvDP2a5YkInHrc7c" -d "$espnCookies" --user-agent "${UA_BROWSER}")
    if [ -z "$tokenContent" ]; then
        echo -n -e "\r ESPN+:${Font_SkyBlue}[Sponsored by Jam]${Font_Suffix}\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tokenContent" | grep 'forbidden-location')
    local is403=$(echo "$tokenContent" | grep '403 ERROR')

    if [ -n "$isBlocked" ] || [ -n "$is403" ]; then
        echo -n -e "\r ESPN+:${Font_SkyBlue}[Sponsored by Jam]${Font_Suffix}\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local fakeContent=$(echo "$MEDIA_COOKIE" | sed -n '10p')
    local refreshToken=$(echo "$tokenContent" | grep -woP '"refresh_token"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$refreshToken" ]; then
        echo -n -e "\r ESPN+:${Font_SkyBlue}[Sponsored by Jam]${Font_Suffix}\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local espnContent=$(echo "$fakeContent" | sed "s/ILOVESTAR/${refreshToken}/g")
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://espn.api.edge.bamgrid.com/graph/v1/device/graphql' -X POST -H "authorization: ZXNwbiZicm93c2VyJjEuMC4w.ptUt7QxsteaRruuPmGZFaJByOoqKvDP2a5YkInHrc7c" -d "$espnContent" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r ESPN+:${Font_SkyBlue}[Sponsored by Jam]${Font_Suffix}\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP '"countryCode"\s{0,}:\s{0,}"\K[^"]+')
    local inSupportedLocation=$(echo "$tmpresult" | grep -woP '"inSupportedLocation"\s{0,}:\s{0,}\K(false|true)')

    if [ -z "$region" ] || [ -z "$inSupportedLocation" ]; then
        echo -n -e "\r ESPN+:${Font_SkyBlue}[Sponsored by Jam]${Font_Suffix}\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$region" == 'US' ] && [ "$inSupportedLocation" == 'true' ]; then
        echo -n -e "\r ESPN+:${Font_SkyBlue}[Sponsored by Jam]${Font_Suffix}\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r ESPN+:${Font_SkyBlue}[Sponsored by Jam]${Font_Suffix}\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_Stan() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Stan:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.stan.com.au/login/v1/sessions/web/account' -X POST -w '_TAG_%{http_code}' --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    local respContent=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Stan:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r Stan:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '411' ]; then
        echo -n -e "\r Stan:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -z "$respContent" ]; then
        echo -n -e "\r Stan:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$respContent" | grep -i 'VPNDetected')
    if [ -z "$result" ]; then
        echo -n -e "\r Stan:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Stan:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_Binge() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://auth.streamotion.com.au' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Binge:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Binge:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Binge:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Binge:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Docplay() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Docplay:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.docplay.com/subscribe' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Docplay:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep -i 'geoblocked')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Docplay:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r Docplay:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Docplay:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Docplay:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_OptusSports() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://sport.optus.com.au/api/userauth/validate/web/username/restriction.check@gmail.com' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Optus Sports:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Optus Sports:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Optus Sports:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Optus Sports:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_KayoSports() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://billingapi.streamotion.com.au/v2/offers/kayo/' -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://kayosports.com.au' -H 'referer: https://kayosports.com.au/' -H "sec-ch-ua: ${SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Kayo Sports:\t\t\t\t${Font_Red}Failed${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Kayo Sports:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Kayo Sports:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Kayo Sports:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_NeonTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Neon TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local neonHeader=$(echo "$MEDIA_COOKIE" | sed -n '12p')
    local neonContent=$(echo "$MEDIA_COOKIE" | sed -n '13p')
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.neontv.co.nz/api/client/gql?' -X POST -H "content-type: application/json" -H "$neonHeader" -d "$neonContent" -w '_TAG_%{http_code}' --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    local respContent=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Neon TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r Neon TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    if [ -z "$respContent" ]; then
        echo -n -e "\r Neon TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$respContent" | grep -i 'RESTRICTED_GEOLOCATION')
    if [ -z "$result" ]; then
        echo -n -e "\r Neon TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Neon TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_SkyGONZ() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r SkyGo NZ:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://login.sky.co.nz/authorize?audience=https%3A%2F%2Fapi.sky.co.nz&client_id=dXhXjmK9G90mOX3B02R1kV7gsC4bp8yx&redirect_uri=https%3A%2F%2Fwww.skygo.co.nz&connection=Sky-Internal-Connection&scope=openid%20profile%20email%20offline_access&response_type=code&response_mode=query&state=OXg3QjBGTHpoczVvdG1fRnJFZXVoNDlPc01vNzZjWjZsT3VES2VhN1dDWA%3D%3D&nonce=OEdvci4xZHBHU3VLb1M0T1JRbTZ6WDZJVGQ3R3J0TTdpTndvWjNMZDM5ZA%3D%3D&code_challenge=My5fiXIl-cX79KOUe1yDFzA6o2EOGpJeb6w1_qeNkpI&code_challenge_method=S256&auth0Client=eyJuYW1lIjoiYXV0aDAtcmVhY3QiLCJ2ZXJzaW9uIjoiMS4zLjAifQ%3D%3D' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r SkyGo NZ:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r SkyGo NZ:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r SkyGo NZ:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r SkyGo NZ:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_ThreeNow() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r ThreeNow:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://bravo-livestream.fullscreen.nz/index.m3u8' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r ThreeNow:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r ThreeNow:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r ThreeNow:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r ThreeNow:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_MaoriTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.maoriplus.co.nz/live-tv/whakaata-maori' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    # 找出 index-*.js
    local indexJsPath=$(echo "$tmpresult" | grep -woP 'src="\K/assets/index-[a-z0-9]{8}[^"]+')
    if [ -z "$indexJsPath" ]; then
        echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    # 下载 index-*.js
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s "https://www.maoriplus.co.nz${indexJsPath}" -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.maoriplus.co.nz' -H 'referer: https://www.maoriplus.co.nz/live-tv/whakaata-maori' -H "sec-ch-ua: ${SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: script' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-origin' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi
    # 取得 brightcove 播放器链接
    local playerJsUrl=$(echo "$tmpresult2" | grep -woP 'players.brightcove.net/[0-9]{13}/\w{9}_default/index.min.js')
    local accountId=$(echo "$playerJsUrl" | grep -woP 'players.brightcove.net/\K[0-9]{13}')
    if [ -z "$playerJsUrl" ]; then
        echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    # 取得 brightcove 播放器信息
    local tmpresult3=$(curl ${CURL_DEFAULT_OPTS} -s "https://${playerJsUrl}" -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'referer: https://www.maoriplus.co.nz/' -H "sec-ch-ua: ${SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: script' -H 'sec-fetch-mode: no-cors' -H 'sec-fetch-site: cross-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult3" ]; then
        echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Network Connection 2)${Font_Suffix}\n"
        return
    fi

    # 取 policy_key
    local policyKey=$(echo "$tmpresult3" | grep -woP 'policyKey\s{0,}:\s{0,}"\KBCpk[^"]+')

    # 由于频道 ID 换的不是特别勤，直接固定，少几个请求
    # 该值从该 API 获取：https://api.one.accedo.tv/content/entries?typeAlias=live-channels
    local bcChannelId='6278939271001'
    # 最终检查
    local tmpresult4=$(curl ${CURL_DEFAULT_OPTS} -s "https://edge.api.brightcove.com/playback/v1/accounts/${accountId}/videos/${bcChannelId}" -H "accept: application/json;pk=${policyKey}" -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.maoriplus.co.nz' -H 'referer: https://www.maoriplus.co.nz/' -H "sec-ch-ua: ${SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult4" ]; then
        echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Network Connection 3)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult4" | grep -woP '"error_subcode"\s{0,}:\s{0,}"\K[^"]+')

    case "$result" in
        'CLIENT_GEO') echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'SUCCESS') echo -n -e "\r Maori TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '') echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r Maori TV:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_SBSonDemand() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r SBS on Demand:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.sbs.com.au/api/v3/network?context=odwebsite' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r SBS on Demand:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"country_code"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$result" ]; then
        echo -n -e "\r SBS on Demand:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$result" == 'AU' ]; then
        echo -n -e "\r SBS on Demand:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r SBS on Demand:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_ABCiView() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r ABC iView:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.iview.abc.net.au/v2/show/abc-kids-live-stream/video/LS1604H001S00?embed=highlightVideo,selectedSeries' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r ABC iView:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'unavailable outside Australia')
    local isOK=$(echo "$tmpresult" | grep -woP '"playable"\s{0,}:\s{0,}\K(false|true)')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r ABC iView:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ] ; then
        echo -n -e "\r ABC iView:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    if [ "$isOK" == 'true' ]; then
        echo -n -e "\r ABC iView:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r ABC iView:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Channel9() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://login.nine.com.au' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Channel 9:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'Geoblock')
    local isOK=$(echo "$tmpresult" | grep -i 'Log in to')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Channel 9:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Channel 9:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Channel 9:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Channel 9:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Telasa() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api-videopass-anon.kddi-video.com/v1/playback/system_status' -H "X-Device-ID: d36f8e6b-e344-4f5e-9a55-90aeb3403799" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Telasa:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isForbidden=$(echo "$tmpresult" | grep -i 'IPLocationNotAllowed')
    local isAllowed=$(echo "$tmpresult" | grep -woP '"type"\s{0,}:\s{0,}"\K[^"]+')

    if [ -z "$isAllowed" ] && [ -z "$isForbidden" ]; then
        echo -n -e "\r Telasa:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isForbidden" ]; then
        echo -n -e "\r Telasa:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$isAllowed" == 'OK' ]; then
        echo -n -e "\r Telasa:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Telasa:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_SetantaSports() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Setanta Sports:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://dce-frontoffice.imggaming.com/api/v2/consent-prompt' -H 'Realm: dce.adjara' -H 'x-api-key: 857a1e5d-e35e-4fdf-805b-a87b6f8364bf' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Setanta Sports:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"outsideAllowedTerritories"\s{0,}:\s{0,}\K(false|true)')
    if [ -z "$result" ]; then
        echo -n -e "\r Setanta Sports:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$result" == 'true' ]; then
        echo -n -e "\r Setanta Sports:\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$result" == 'false' ]; then
        echo -n -e "\r Setanta Sports:\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Setanta Sports:\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_MolaTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Mola TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://mola.tv/api/v2/videos/geoguard/check/vd30491025' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Mola TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"isAllowed"\s{0,}:\s{0,}\K(false|true)')
    if [ -z "$result" ]; then
        echo -n -e "\r Mola TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$result" == 'true' ]; then
        echo -n -e "\r Mola TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi
    if [ "$result" == 'false' ]; then
        echo -n -e "\r Mola TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Mola TV:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_BeinConnect() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Bein Sports Connect:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://proxies.bein-mena-production.eu-west-2.tuc.red/proxy/availableOffers' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r Bein Sports Connect:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '500') echo -n -e "\r Bein Sports Connect:\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '451') echo -n -e "\r Bein Sports Connect:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r Bein Sports Connect:\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_EurosportRO() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Eurosport RO:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local fakeUuid=$(gen_uuid)
    # 取得 Bearer 认证 token
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://eu3-prod-direct.eurosport.ro/token?realm=eurosport' -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://www.eurosport.ro' -H 'referer: https://www.eurosport.ro/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H "x-device-info: escom/0.295.1 (unknown/unknown; Windows/10; ${fakeUuid})" -H 'x-disco-client: WEB:UNKNOWN:escom:0.295.1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Eurosport RO:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local token=$(echo "$tmpresult" | grep -woP '"token"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$token" ]; then
        echo -n -e "\r Eurosport RO:\t\t\t\t${Font_Red}Failed (Error: PAGER ERROR)${Font_Suffix}\n"
        return
    fi

    # 随便选的视频
    local sourceSystemId='eurosport-vid2133403'
    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -s "https://eu3-prod-direct.eurosport.ro/playback/v2/videoPlaybackInfo/sourceSystemId/${sourceSystemId}?usePreAuth=true" -H "Authorization: Bearer ${token}" --user-agent "${UA_BROWSER}")

    local isBlocked=$(echo "$tmpresult1" | grep 'access.denied.geoblocked')
    local isOK=$(echo "$tmpresult1" | grep 'eurosport-vod')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Eurosport RO:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Eurosport RO:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Eurosport RO:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Eurosport RO:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Channel5() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Channel 5:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local timestamp=$(date +%s)
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL "https://cassie.channel5.com/api/v2/live_media/my5desktopng/C5.json?timestamp=${timestamp}&auth=0_rZDiY0hp_TNcDyk2uD-Kl40HqDbXs7hOawxyqPnbI" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Channel 5:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}"\K[^"]+')

    case "$result" in
        '3000') echo -n -e "\r Channel 5:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '4003') echo -n -e "\r Channel 5:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '') echo -n -e "\r Channel 5:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r Channel 5:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_MyVideo() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r MyVideo:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.myvideo.net.tw/login.do' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')

    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r MyVideo:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep -i 'serviceAreaBlock')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r MyVideo:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r MyVideo:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r MyVideo:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r MyVideo:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_7plus() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r 7plus:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result1=$(curl ${CURL_DEFAULT_OPTS} -fsL "https://7plus-sevennetwork.akamaized.net/media/v1/dash/live/cenc/5303576322001/68dca38b-85d7-4dae-b1c5-c88acc58d51c/f4ea4711-514e-4cad-824f-e0c87db0a614/225ec0a0-ef18-4b7c-8fd6-8dcdd16cf03a/1x/segment0.m4f?akamai_token=exp=1672500385~acl=/media/v1/dash/live/cenc/5303576322001/68dca38b-85d7-4dae-b1c5-c88acc58d51c/f4ea4711-514e-4cad-824f-e0c87db0a614/*~hmac=800e1e1d1943addf12b71339277c637c7211582fe12d148e486ae40d6549dbde" -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    if [ "$result1" == '000' ]; then
        echo -n -e "\r 7plus:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    if [ "$result1" == '200' ]; then
        echo -n -e "\r 7plus:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    else
        echo -n -e "\r 7plus:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
}

function MediaUnlockTest_Channel10() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Channel 10:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://e410fasadvz.global.ssl.fastly.net/geo' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Channel 10:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"allow"\s{0,}:\s{0,}\K(false|true)')
    if [ -z "$result" ]; then
        echo -n -e "\r Channel 10:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$result" == 'true' ]; then
        echo -n -e "\r Channel 10:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi
    if [ "$result" == 'false' ]; then
        echo -n -e "\r Channel 10:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Channel 10:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Spotify() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://spclient.wg.spotify.com/signup/public/v1/account' -d "birth_day=11&birth_month=11&birth_year=2000&collect_personal_info=undefined&creation_flow=&creation_point=https%3A%2F%2Fwww.spotify.com%2Fhk-en%2F&displayname=Gay%20Lord&gender=male&iagree=1&key=a1e486e2729f46d6bb368d6b2bcda326&platform=www&referrer=&send-email=0&thirdpartyemail=0&identifier_token=AgE6YTvEzkReHNfJpO114514" -X POST -H "Accept-Language: en" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Spotify Registration:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local statusCode=$(echo "$tmpresult" | grep -woP '"status"\s{0,}:\s{0,}\K\d+')
    local region=$(echo "$tmpresult" | grep -woP '"country"\s{0,}:\s{0,}"\K[^"]+')
    local isLaunched=$(echo "$tmpresult" | grep -woP '"is_country_launched"\s{0,}:\s{0,}\K(false|true)')

    if [ -z "$statusCode" ]; then
        echo -n -e "\r Spotify Registration:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$statusCode" == '320' ] || [ "$statusCode" == '120' ]; then
        echo -n -e "\r Spotify Registration:\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -z "$isLaunched" ] || [ -z "$region" ]; then
        echo -n -e "\r Spotify Registration:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$isLaunched" == 'false' ]; then
        echo -n -e "\r Spotify Registration:\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$statusCode" == '311' ]; then
        echo -n -e "\r Spotify Registration:\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Spotify Registration:\t\t\t${Font_Red}Failed (Error: $statusCode)${Font_Suffix}\n"
}

function MediaUnlockTest_VideoMarket() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r VideoMarket:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.videomarket.jp/graphql' -H 'authority: www.videomarket.jp' -H 'accept: */*' -H 'accept-language: zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6' -H 'authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjQ4MTkxNTkyMDIsImlhdCI6MTY2NTU1OTIwMiwiaXNzIjoiaHR0cHM6Ly9hdXRoLnZpZGVvbWFya2V0LmpwIiwic3ViIjoiY2ZjZDIwODQ5NWQ1NjVlZjY2ZTdkZmY5Zjk4NzY0ZGEiLCJ1c2VyX3R5cGUiOjAsInNpdGVfdHlwZSI6MiwiY2xpZW50X2lkIjoiYmVkNDdkOTFiMDVhYjgzMGM4YzBhYmFiYjQwNTg5MTFhY2E5NTdkMDBkMTUzNjA2MjI3NzNhOTQ0Y2RlNzRhNSIsInZtaWQiOjB9.Tq18RCxpVz1oV1lja52uRmF0nT6Oa0QsZMTVlPfANwb-RrcSn7PwE9vh7GdNIBc0ydDxRoUMuhStz_Kbu8KxvAh25eafFh7hf0DDqWKKU4ayPMueaR12t74SjFIRC7Cla1NR4uRn3_mgJfZFqOkIf6L5OR9LOVIBhrQPkhbMyqwZyh_kxTH7ToJIQoINb036ftqcF1KfR8ndtBlkrrWWnDpfkmE7-fJQHh92oKKd9l98W5awuEQo0MFspIdSNgt3gLi9t1RRKPDISGlzJkwMLPkHIUlWWZaAmnEkwSeZCPj_WJaqUqBATYKhi3yJZNGlHsScQ_KgAopxlsI6-c88Gps8i6yHvPVYw3hQ9XYq9gVL_SpyW9dKKSPE9MY6I19JHLBXuFXi5OJccqtQzTnKm_ZQM3EcKt5s0cNlXm9RMt0fNdRTQdJ53noD9o-b6hUIxDcHScJ_-30Emiv-55g5Sq9t5KPWO6o0Ggokkj42zin69MxCiUSHXk5FgeY8rX76yGBeLPLPIaaRPXEC1Jeo1VO56xNnQpyX_WHqHWDKhmOh1qSzaxiAiC5POMsTfwGr19TwXHUldYXxuNMIfeAaPZmNTzR5J6XdenFkLnrssVzXdThdlqHpfguLFvHnXTCAm0ZhFIJmacMNw1IxGmCQfkM4HtgKB9ZnWm6P0jIISdg' -H 'content-type: application/json' -H 'cookie: _gid=GA1.2.1853799793.1706147718; VM_REGIST_BANNER_REF_LINK=%2Ftitle%2F292072; __ulfpc=202401250957239984; _im_vid=01HMZ5C5GNNC6VWSPKD3E4W7YP; __td_signed=true; _td_global=0d11678b-5151-473e-b3a8-4f4d780f26a6; __juicer_sesid_9i3nsdfP_=d36a2e17-0117-47ce-95de-fbd5ffcda2d9; __juicer_session_referrer_9i3nsdfP_=d36a2e17-0117-47ce-95de-fbd5ffcda2d9___https%253A%252F%252Fwww.videomarket.jp%252Fplayer%252F292072%252FA292072001999H01; _gat_UA-221872486-2=1; _ga=GA1.2.777206008.1706147718; _ga_8HZQ9F8HV0=GS1.1.1706147717.1.1.1706147941.0.0.0; _td=3317738c-2329-4b61-ad5a-4e0ad230841d; dc_cl_id=ab38GzrmoV7muvtI' -H 'origin: https://www.videomarket.jp' -H 'referer: https://www.videomarket.jp/player/292072/A292072001999H01' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-origin' -H 'x-videomarket-requested: spa' --data-raw $'{"operationName":"repPacks","variables":{"repFullPackIds":["A292072001999H01"],"isOnSale":false,"isOnlyLatest":true},"query":"query repPacks($repFullPackIds: [String], $fullPacksIds: [String], $isOnSale: Boolean\u0021, $isOnlyLatest: Boolean\u0021) {\\n  repPacks(\\n    repFullPackIds: $repFullPackIds\\n    fullPackIds: $fullPacksIds\\n    onSale: $isOnSale\\n    onlyLatest: $isOnlyLatest\\n  ) {\\n    repFullPackId\\n    groupType\\n    packName\\n    fullTitleId\\n    titleName\\n    storyImageUrl16x9\\n    playTime\\n    subtitleDubType\\n    outlines\\n    courseIds\\n    price\\n    discountRate\\n    couponPrice\\n    couponDiscountRate\\n    rentalDays\\n    viewDays\\n    deliveryExpiredAt\\n    salesType\\n    counter {\\n      currentPage\\n      currentResult\\n      totalPages\\n      totalResults\\n      __typename\\n    }\\n    undiscountedPrice\\n    packs {\\n      undiscountedPrice\\n      canPurchase\\n      fullPackId\\n      subGroupType\\n      fullTitleId\\n      qualityConsentType\\n      courseIds\\n      price\\n      discountRate\\n      couponPrice\\n      couponDiscountRate\\n      rentalDays\\n      viewDays\\n      deliveryExpiredAt\\n      salesType\\n      extId\\n      stories {\\n        fullStoryId\\n        subtitleDubType\\n        encodeVersion\\n        isDownloadable\\n        isBonusMaterial\\n        fileSize\\n        __typename\\n      }\\n      __typename\\n    }\\n    status {\\n      hasBeenPlayed\\n      isCourseRegistered\\n      isEstPurchased\\n      isNowPlaying\\n      isPlayable\\n      isRented\\n      playExpiredAt\\n      playableQualityType\\n      rentalExpiredAt\\n      __typename\\n    }\\n    __typename\\n  }\\n}\\n"}'  --user-agent "${UA_BROWSER}")

    if [ -z "$tmpresult" ]; then
        echo -n -e "\r VideoMarket:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep 'OverseasAccess')
    local isOK=$(echo "$tmpresult" | grep '292072')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r VideoMarket:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r VideoMarket:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r VideoMarket:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r VideoMarket:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
}

function MediaUnlockTest_JCOM_ON_DEMAND() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://auth.id2.zaq.ne.jp/login' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r J:com On Demand:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r J:com On Demand:\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r J:com On Demand:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r J:com On Demand:\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_musicjp() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r music.jp:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

     local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://overseaauth.music-book.jp/globalIpcheck.js' -w '_TAG_%{http_code}' --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    local respContent=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    local isOK=$(echo "$respContent" | grep -i 'checkIp')

    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r music.jp:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r music.jp:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -z "$respContent" ]; then
        echo -n -e "\r music.jp:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r music.jp:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r music.jp:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
}

function MediaUnlockTest_InstagramMusic() {
    ARCH=$(uname -m)

    if [ "$ARCH" = "x86_64" ]; then
        curl -sL -o ./ins https://github.com/lmc999/RegionRestrictionCheck/raw/refs/heads/main/binary/ins_amd64
        chmod +x ./ins
        clear
        ./ins
    elif [ "$ARCH" = "aarch64" ]; then
        curl -sL -o ./ins https://github.com/lmc999/RegionRestrictionCheck/raw/refs/heads/main/binary/ins_arm64
        chmod +x ./ins
        clear
        ./ins
    else
        echo "Unsupported architecture: $ARCH"
        exit 1
    fi

    rm ./ins
    exit 0
}

function WebTest_Reddit() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Reddit:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.reddit.com/' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")
    case "$result" in
        '000') echo -n -e "\r Reddit:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '403') echo -n -e "\r Reddit:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Reddit:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Reddit:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Popcornflix() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Popcornflix:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -s 'https://popcornflix-prod.cloud.seachange.com/cms/popcornflix/clientconfiguration/versions/2' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")
    if [ "$result" == '000' ]; then
        echo -n -e "\r Popcornflix:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    case "$result" in
        '403') echo -n -e "\r Popcornflix:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Popcornflix:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Popcornflix:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_TubiTV() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://tubitv.com/home' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Tubi TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'not currently available in your area')
    local isOK=$(echo "$tmpresult" | grep -i 'manifest')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Tubi TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Tubi TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Tubi TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Tubi TV:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Philo() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Philo:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://content-us-east-2-fastly-b.www.philo.com/geo' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Philo:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"status"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$result" ]; then
        echo -n -e "\r Philo:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    case "$result" in
        'FAIL') echo -n -e "\r Philo:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'SUCCESS') echo -n -e "\r Philo:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Philo:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_FXNOW() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r FXNOW:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://fxnow.fxnetworks.com/' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r FXNOW:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'is not accessible')
    local isOK=$(echo "$tmpresult" | grep -i "FX Movies")

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r FXNOW:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r FXNOW:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r FXNOW:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r FXNOW:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Crunchyroll() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Crunchyroll:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://c.evidon.com/geo/country.js' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Crunchyroll:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep "'code':'us'")
    if [ -z "$result" ]; then
        echo -n -e "\r Crunchyroll:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
    else
        echo -n -e "\r Crunchyroll:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
    fi
}

function MediaUnlockTest_CWTV() {
    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL "https://www.cwtv.com/" -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r CW TV:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '403'|'451') echo -n -e "\r CW TV:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '200') echo -n -e "\r CW TV:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r CW TV:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Shudder() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.shudder.com/' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Shudder:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -iE 'not available|not yet available|403 ERROR')
    local isOK=$(echo "$tmpresult" | grep -i 'movies')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Shudder:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Shudder:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Shudder:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Shudder:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_TLCGO() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r TLC GO:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local fakeDeviceId=$(gen_uuid)
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s "https://us1-prod-direct.tlc.com/token?deviceId=${fakeDeviceId}&realm=go&shortlived=true" -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://go.tlc.com' -H 'referer: https://go.tlc.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H 'x-device-info: tlc/3.17.0 (desktop/desktop; Windows/NT 10.0; ${fakeDeviceId})' -H 'x-disco-client: WEB:UNKNOWN:tlc:3.17.0' -H 'x-disco-params: realm=go,siteLookupKey=tlc,bid=tlc,hn=go.tlc.com,hth=us,features=ar' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r TLC GO:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local token=$(echo "$tmpresult" | grep -woP '"token"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$token" ]; then
        echo -n -e "\r TLC GO:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -s 'https://us1-prod-direct.tlc.com/cms/routes/home?include=default&decorators=viewingHistory,isFavorite,playbackAllowed&page\[items.number\]=1&page\[items.size\]=8' -H 'accept-language: en-US,en;q=0.9' -H "Authorization: Bearer ${token}" -H 'origin: https://go.tlc.com' -H 'referer: https://go.tlc.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H 'x-disco-client: WEB:UNKNOWN:tlc:3.17.0' -H 'x-disco-params: realm=go,siteLookupKey=tlc,bid=tlc,hn=go.tlc.com,hth=us,features=ar' --user-agent "${UA_BROWSER}")

    local isBlocked=$(echo "$tmpresult1" | grep -i 'is not yet available')
    local isOK=$(echo "$tmpresult1" | grep -i 'Episodes')
    local region=$(echo "$tmpresult1" | grep -woP '"mainTerritoryCode"\s{0,}:\s{0,}"\K[^"]+' | tr a-z A-Z)

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r TLC GO:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r TLC GO:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r TLC GO:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r TLC GO:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function RegionTest_oneTrust() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://geolocation.onetrust.com/cookieconsentpub/v1/geo/location'  --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r OneTrust Region:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP '"country"\s{0,}:\s{0,}"\K[^"]+')
    local stateName=$(echo "$tmpresult" | grep -woP '"stateName"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$region" ]; then
        echo -n -e "\r OneTrust Region:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ -z "$stateName" ]; then
        local stateName='Unknown'
    fi

    echo -n -e "\r OneTrust Region:\t\t\t${Font_Green}${region} [${stateName}]${Font_Suffix}\n"
}

function MediaUnlockTest_Wavve() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Wavve:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://apis.wavve.com/fz/streaming?device=pc&partner=pooq&apikey=E5F3E0D30947AA5440556471321BB6D9&credential=none&service=wavve&pooqzone=none&region=kor&drm=pr&targetage=all&contentid=MV_C3001_C300000012559&contenttype=movie&hdr=sdr&videocodec=avc&audiocodec=ac3&issurround=n&format=normal&withinsubtitle=n&action=dash&protocol=dash&quality=auto&deviceModelId=Windows%2010&guid=1a8e9c88-6a3b-11ed-8584-eed06ef80652&lastplayid=none&authtype=cookie&isabr=y&ishevc=n' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")
    if [ "$result" == '000' ]; then
        echo -n -e "\r Wavve:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    case "$result" in
        '403'|'550') echo -n -e "\r Wavve:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '200') echo -n -e "\r Wavve:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r Wavve:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Tving() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Tving:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://api.tving.com/v2a/media/stream/info?apiKey=1e7952d0917d6aab1f0293a063697610&mediaCode=RV60891248' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Tving:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'available in South Korea')
    local isOK=$(echo "$tmpresult" | grep 'vod_type')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Tving:\t\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Tving:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r Tving:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Tving:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_CoupangPlay() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Coupang Play:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.coupangplay.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o /dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')

    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Coupang Play:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep -i 'not-available')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Coupang Play:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r Coupang Play:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r Coupang Play:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Coupang Play:\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_NaverTV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Naver TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local ts=$(date +%s%3N)
    local base_url='https://apis.naver.com/'
    local key='nbxvs5nwNG9QKEWK0ADjYA4JZoujF4gHcIwvoCxFTPAeamq5eemvt5IWAYXxrbYM'
    local sign_text="https://apis.naver.com/now_web2/now_web_api/v1/clips/31030608/play-info${ts}"
    local signature=$(printf "%s" "${sign_text}" | openssl dgst -sha1 -hmac "${key}" -binary | openssl base64)
    local signature_encoded=$(printf "%s" "${signature}" | sed 's/ /%20/g;s/!/%21/g;s/"/%22/g;s/#/%23/g;s/\$/%24/g;s/\&/%26/g;s/'\''/%27/g;s/(/%28/g;s/)/%29/g;s/\*/%2a/g;s/+/%2b/g;s/,/%2c/g;s/\//%2f/g;s/:/%3a/g;s/;/%3b/g;s/=/%3d/g;s/?/%3f/g;s/@/%40/g;s/\[/%5b/g;s/\]/%5d/g')
    local req_url="${base_url}now_web2/now_web_api/v1/clips/31030608/play-info?msgpad=${ts}&md=${signature_encoded}"
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s "${req_url}" --user-agent "${UA_Browser}" -H 'host: apis.naver.com' -H "sec-ch-ua: ${UA_SecCHUA}" -H 'accept: application/json, text/plain, */*' -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'origin: https://tv.naver.com' -H 'sec-fetch-site: same-site' -H 'sec-fetch-mode: cors' -H 'sec-fetch-dest: empty' -H 'referer: https://tv.naver.com/v/31030608' -H 'accept-language: en-US,en;q=0.9')

    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Naver TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"playable"\s{0,}:\s{0,}"\K[^"]+')

    case "$result" in
        'NOT_COUNTRY_AVAILABLE') echo -n -e "\r Naver TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'PLAYABLE') echo -n -e "\r Naver TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '') echo -n -e "\r Naver TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r Naver TV:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Afreeca() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Afreeca TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://vod.afreecatv.com/player/97464151' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Afreeca TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep "document.location.href='https://vod.afreecatv.com'" )
    if [ -z "$result" ]; then
        echo -n -e "\r Afreeca TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
    else
        echo -n -e "\r Afreeca TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
    fi
}

function MediaUnlockTest_KBSDomestic() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r KBS Domestic:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://vod.kbs.co.kr/index.html?source=episode&sname=vod&stype=vod&program_code=T2022-0690&program_id=PS-2022164275-01-000&broadcast_complete_yn=N&local_station_code=00&section_code=03' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r KBS Domestic:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep 'ipck' | grep -woP 'Domestic\\\"\s{0,}:\s{0,}\K(false|true)')

    if [ -z "$result" ]; then
        echo -n -e "\r KBS Domestic:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$result" == 'true' ]; then
        echo -n -e "\r KBS Domestic:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi
    if [ "$result" == 'false' ]; then
        echo -n -e "\r KBS Domestic:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r KBS Domestic:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_KBSAmerican() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r KBS American:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://vod.kbs.co.kr/index.html?source=episode&sname=vod&stype=vod&program_code=T2022-0690&program_id=PS-2022164275-01-000&broadcast_complete_yn=N&local_station_code=00&section_code=03' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r KBS American:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep 'ipck' | grep -woP 'Domestic\\\"\s{0,}:\s{0,}\K(false|true)')

    if [ -z "$result" ]; then
        echo -n -e "\r KBS American:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$result" == 'true' ]; then
        echo -n -e "\r KBS American:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi
    if [ "$result" == 'false' ]; then
        echo -n -e "\r KBS American:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r KBS American:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Watcha() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r WATCHA:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://watcha.com/' -w %{http_code} -o /dev/null -H 'host: watcha.com' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'upgrade-insecure-requests: 1' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'sec-fetch-site: none' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-user: ?1' -H 'sec-fetch-dest: document' -H 'accept-language: en-US,en;q=0.9' --user-agent "${UA_BROWSER}")

    case "$result" in
        '000') echo -n -e "\r WATCHA:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n" ;;
        '200') echo -n -e "\r WATCHA:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '451') echo -n -e "\r WATCHA:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r WATCHA:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_KOCOWA() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r KOCOWA:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local result=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.kocowa.com/' -w %{http_code} -o /dev/null --user-agent "${UA_BROWSER}")

    if [ "$result" == '000' ]; then
        echo -n -e "\r KOCOWA:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    case "$result" in
        '200') echo -n -e "\r KOCOWA:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '403') echo -n -e "\r KOCOWA:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r KOCOWA:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_NBCTV() {
    local fakeUuid=$(gen_uuid | tr a-z A-Z)
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://geolocation.digitalsvc.apps.nbcuni.com/geolocation/live/usa' -H 'accept: application/media.geo-v2+json' -H 'accept-language: en-US,en;q=0.9' -H "app-session-id: ${fakeUuid}" -H 'authorization: NBC-Basic key="usa_live", version="3.0", type="cpc"' -H 'client: oneapp' -H 'content-type: application/json' -H 'origin: https://www.nbc.com' -H 'referer: https://www.nbc.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' --data-raw '{"adobeMvpdId":null,"serviceZip":null,"device":"web"}' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r NBC TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"restricted"\s{0,}:\s{0,}\K(false|true)')

    case "$result" in
        'false') echo -n -e "\r NBC TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        'true') echo -n -e "\r NBC TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '') echo -n -e "\r NBC TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r NBC TV:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_Crackle() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sLi 'https://prod-api.crackle.com/appconfig' -w "_TAG_%{http_code}_TAG_" -H 'Accept-Language: en-US,en;q=0.9' -H 'Content-Type: application/json' -H 'Origin: https://www.crackle.com' -H 'Referer: https://www.crackle.com/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-site' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'x-crackle-apiversion: v2.0.0' -H 'x-crackle-brand: crackle' -H 'x-crackle-platform: 5FE67CCA-069A-42C6-A20F-4B47A8054D46' --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Crackle:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP 'x-crackle-region:\s{0,}\K[A-Z]+')

    if [ -z "$region" ]; then
        echo -n -e "\r Crackle:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$region" == 'US' ]; then
        echo -n -e "\r Crackle:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
    else
        echo -n -e "\r Crackle:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
    fi
}

function MediaUnlockTest_AETV() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r A&E TV:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://link.theplatform.com/s/xc6n8B/UR27JDU0bu2s/' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r A&E TV:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'GeoLocationBlocked')
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r A&E TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -s 'https://play.aetv.com/' -o /dev/null -D - --user-agent "${UA_BROWSER}")

    local region=$(echo "$tmpresult1" | grep -woP 'AETN-Country-Code=\K[A-Z]+' | head -n 1)
    if [ -z "$region" ]; then
        echo -n -e "\r A&E TV:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    case "$region" in
        'CA'|'US') echo -n -e "\r A&E TV:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r A&E TV:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_NFLPlus() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r NFL+:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.nfl.com/plus/' -w '%{http_code}_TAG_%{url_effective}\n' -o dev/null --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r NFL+:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep -iE 'nfl-game-pass|gpi.nfl.com')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r NFL+:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r NFL+:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r NFL+:\t\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function MediaUnlockTest_SkyShowTime() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://www.skyshowtime.com/' -w "_TAG_%{http_code}_TAG_" -o /dev/null -D - -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r SkyShowTime:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r SkyShowTime:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'where-can-i-stream')
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r SkyShowTime:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP 'activeTerritory=\K[A-Z]+' | head -n 1)
    if [ -z "$region" ]; then
        echo -n -e "\r SkyShowTime:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r SkyShowTime:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r SkyShowTime:\t\t\t\t${Font_Red}Faild (Error: ${httpCode})${Font_Suffix}\n"
}

function GameTest_MathsSpot() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://mathsspot.com/' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'FailureServiceNotInRegion')
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local apiPath=$(echo "$tmpresult" | grep -woP 'fetch\("\K[^"]+' | grep 'reportEvent' | sed 's/\/reportEvent//;s/^\///')
    local region=$(echo "$tmpresult" | grep -woP '"countryCode"\s{0,}:\s{0,}"\K[^"]+')
    local nggFeVersion=$(echo "$tmpresult" | grep -woP '"NEXT_PUBLIC_FE_VERSION"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$apiPath" ] || [ -z "$nggFeVersion" ] || [ -z "$region" ]; then
        echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local fakeUAId=$(gen_random_str 21)
    local fakeSessId=$(gen_random_str 21)
    local fakeFesessId=$(gen_random_str 21)
    local fakeVisitId=$(gen_random_str 21)

    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -sL "https://mathsspot.com/${apiPath}/startSession?appId=5349&uaId=ua-${fakeUAId}&uaSessionId=uasess-${fakeSessId}&feSessionId=fesess-${fakeFesessId}&visitId=visitid-${fakeVisitId}&initialOrientation=landscape&utmSource=NA&utmMedium=NA&utmCampaign=NA&deepLinkUrl=&accessCode=&ngReferrer=NA&pageReferrer=NA&ngEntryPoint=https%3A%2F%2Fmathsspot.com%2F&ntmSource=NA&customData=&appLaunchExtraData=&feSessionTags=nowgg&sdpType=&eVar=&isIframe=false&feDeviceType=desktop&feOsName=window&userSource=direct&visitSource=direct&userCampaign=NA&visitCampaign=NA" -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'referer: https://mathsspot.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-origin' -H 'x-ngg-skip-evar-check: true' -H "x-ngg-fe-version: ${nggFeVersion}")
    if [ -z "$tmpresult1" ]; then
        echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local status=$(echo "$tmpresult1" |  grep -woP '"status"\s{0,}:\s{0,}"\K[^"]+' | head -n 1)
    if [ -z "$status" ]; then
        echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}Failed (Error: PAGE ERROR 1)${Font_Suffix}\n"
        return
    fi

    case "$status" in
        'FailureServiceNotInRegion') echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'FailureProxyUserLimitExceeded') echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}No (Proxy/VPN Detected)${Font_Suffix}\n" ;;
        'Success') echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n" ;;
        *) echo -n -e "\r MathsSpot Roblox:\t\t\t${Font_Red}Failed (Error: $status)${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_BGlobalSEA() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r B-Global SouthEastAsia:\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&ep_id=347666' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r B-Global SouthEastAsia:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[-\d]+' | head -n 1)

    case "$result" in
        '0') echo -n -e "\r B-Global SouthEastAsia:\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '10003003'|'10004001') echo -n -e "\r B-Global SouthEastAsia:\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r B-Global SouthEastAsia:\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_BGlobalTH() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r B-Global Thailand Only:\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&ep_id=10077726' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r B-Global Thailand Only:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[-\d]+' | head -n 1)

    case "$result" in
        '0') echo -n -e "\r B-Global Thailand Only:\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '10003003'|'10004001') echo -n -e "\r B-Global Thailand Only:\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r B-Global Thailand Only:\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_BGlobalID() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r B-Global Indonesia Only:\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -fsL 'https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&ep_id=11130043' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r B-Global Indonesia Only:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[-\d]+' | head -n 1)

    case "$result" in
        '0') echo -n -e "\r B-Global Indonesia Only:\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '10003003'|'10004001') echo -n -e "\r B-Global Indonesia Only:\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r B-Global Indonesia Only:\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_BGlobalVN() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r B-Global Việt Nam Only:\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&ep_id=11405745' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r B-Global Việt Nam Only:\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K[-\d]+' | head -n 1)

    case "$result" in
        '0') echo -n -e "\r B-Global Việt Nam Only:\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '10003003'|'10004001') echo -n -e "\r B-Global Việt Nam Only:\t\t${Font_Red}No${Font_Suffix}\n" ;;
        *) echo -n -e "\r B-Global Việt Nam Only:\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_AISPlay() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local userId='09e8b25510'
    local userPasswd='e49e9f9e7f'
    local fakeApiKey=$(gen_uuid | md5sum | cut -f1 -d' ')
    local fakeUdid=$(gen_uuid | md5sum | cut -f1 -d' ')
    local timestamp=$(date +%s)
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL "https://web-tls.ais-vidnt.com/device/login/?d=gstweb&gst=1&user=${userId}&pass=${userPasswd}" -H 'accept-language: th' -H 'api-version: 2.8.2' -H "api_key: ${fakeApiKey}" -H 'content-type: multipart/form-data; boundary=----WebKitFormBoundaryBj2RhUIW7BtRvfK0' -H 'device-info: com.vimmi.ais.portal, Windows + Chrome, AppVersion: 4.9.97, 10, language: tha' -H 'origin: https://aisplay.ais.co.th' -H "privateid: ${userId}" -H 'referer: https://aisplay.ais.co.th/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: cross-site' -H "time: ${timestamp}" -H "udid: ${fakeUdid}" --data-raw $'------WebKitFormBoundaryBj2RhUIW7BtRvfK0--\r\n' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local sId=$(echo "$tmpresult" | grep -woP '"sid"\s{0,}:\s{0,}"\K[^"]+')
    local datAuth=$(echo "$tmpresult" | grep -woP '"dat"\s{0,}:\s{0,}"\K[^"]+')
    # 新时间戳
    local timestamp=$(date +%s)
    # 取播放模板
    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://web-sila.ais-vidnt.com/playtemplate/?d=gstweb' -H 'accept-language: en-US,en;q=0.9' -H 'api-version: 2.8.2' -H "api_key: ${fakeApiKey}" -H "dat: ${datAuth}" -H 'device-info: com.vimmi.ais.portal, Windows + Chrome, AppVersion: 0.0.0, 10, Language: unknown' -H 'origin: https://web-player.ais-vidnt.com' -H "privateid: ${userId}" -H 'referer: https://web-player.ais-vidnt.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' -H "sid: ${sId}" -H "time: ${timestamp}" -H "udid: ${fakeUdid}" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult1" ]; then
        echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local tmpLiveUrl=$(echo "$tmpresult1" | grep -woP '"live"\s{0,}:\s{0,}"\K[^"]+')
    if [ -z "$tmpLiveUrl" ]; then
        echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local mediaId='B0006'
    local realLiveUrl=$(echo "$tmpLiveUrl" | sed "s/{MID}/${mediaId}/g;s/metadata.xml/metadata.json/g" )
    local realLiveUrl="${realLiveUrl}-https&tuid=${userId}&tdid=${fakeUdid}&chunkHttps=true&origin=anevia"
    # example: 'https://redirector.ais-vidnt.com/live/ais/B0006/hls/metadata.json?https_streaming=true&tt=f0037b2dae1b884e32fa90f00f146b7e&tpbk=DOGPcIOg1bIpIIrW&tfa=f0-fc&tttlt=1716631179&cdn=live_free-https&tuid=09e8b25510&tdid=01552b8e90f7e9f9e94ea4779cec29e6&chunkHttps=true&origin=anevia'

    # 取剧集播放网址
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -sL "$realLiveUrl" -H 'Accept-Language: en-US,en;q=0.9' -H 'Origin: https://web-player.ais-vidnt.com' -H 'Referer: https://web-player.ais-vidnt.com/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-site' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --user-agent "${UA_BROWSER}")

    # 取第一优先级播放地址
    local playUrl=$(echo "$tmpresult2" | grep -woP '"url"\s{0,}:\s{0,}"\K[^"]+' | grep 'rewriter' | head -n 1)
    if [ -z "$playUrl" ]; then
        echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local tmpresult3=$(curl ${CURL_DEFAULT_OPTS} -sLi "$playUrl" -H 'Accept-Language: en-US,en;q=0.9' -H 'Origin: https://web-player.ais-vidnt.com' -H 'Referer: https://web-player.ais-vidnt.com/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-site' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --user-agent "${UA_BROWSER}")

    # X-Base-Request-Check-Status: INCORRECT X-Geo-Protection-System-Status: BLOCK
    local baseRequstCheckStatus=$(echo "$tmpresult3" | grep -woP 'X-Base-Request-Check-Status:\s{0,}\K\w+')
    if [ -z "$baseRequstCheckStatus" ]; then
        echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi
    if [ "$baseRequstCheckStatus" == 'INCORRECT' ]; then
        echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local result="$(echo "$tmpresult3" | grep -woP 'X-Geo-Protection-System-Status:\s{0,}\K\w+')"

    case "$result" in
        'BLOCK') echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'ALLOW') echo -n -e "\r AIS Play:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '') echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n" ;;
        *) echo -n -e "\r AIS Play:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function WebTest_OpenAI() {
    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -s 'https://api.openai.com/compliance/cookie_requirements' -H 'authority: api.openai.com' -H 'accept: */*' -H 'accept-language: en-US,en;q=0.9' -H 'authorization: Bearer null' -H 'content-type: application/json' -H 'origin: https://platform.openai.com' -H 'referer: https://platform.openai.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --user-agent "${UA_BROWSER}")
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s 'https://ios.chat.openai.com/' -H 'authority: ios.chat.openai.com' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult1" ]; then
        echo -n -e "\r ChatGPT:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r ChatGPT:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result1=$(echo "$tmpresult1" | grep -i 'unsupported_country')
    local result2=$(echo "$tmpresult2" | grep -i 'VPN')
    if [ -z "$result2" ] && [ -z "$result1" ]; then
        echo -n -e "\r ChatGPT:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi
    if [ -n "$result2" ] && [ -n "$result1" ]; then
        echo -n -e "\r ChatGPT:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -z "$result1" ] && [ -n "$result2" ]; then
        echo -n -e "\r ChatGPT:\t\t\t\t${Font_Yellow}No (Only Available with Web Browser)${Font_Suffix}\n"
        return
    fi
    if [ -n "$result1" ] && [ -z "$result2" ]; then
        echo -n -e "\r ChatGPT:\t\t\t\t${Font_Yellow}No (Only Available with Mobile APP)${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r ChatGPT:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function WebTest_Gemini() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL "https://gemini.google.com" --user-agent "${UA_BROWSER}")
    if [[ "$tmpresult" = "curl"* ]]; then
        echo -n -e "\r Google Gemini:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    result=$(echo "$tmpresult" | grep -q '45631641,null,true' && echo "Yes" || echo "")
    countrycode=$(echo "$tmpresult" | grep -o ',2,1,200,"[A-Z]\{3\}"' | sed 's/,2,1,200,"//;s/"//' || echo "")
    if [ -n "$result" ] && [ -n "$countrycode" ]; then
        echo -n -e "\r Google Gemini:\t\t\t\t${Font_Green}Yes (Region: $countrycode)${Font_Suffix}\n"
        return
    elif [ -n "$result" ]; then
        echo -n -e "\r Google Gemini:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    else
        echo -n -e "\r Google Gemini:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
}

function WebTest_Claude() {
    local UA_Browser="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    local response=$(curl ${CURL_DEFAULT_OPTS} -s -o /dev/null -w "%{http_code}" -A "${UA_Browser}" "https://claude.ai/")
    if [ -z "$response" ]; then
        echo -n -e "\r Claude:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    if [ "$response" -eq 200 ]; then
        echo -n -e "\r Claude:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
    else
        echo -n -e "\r Claude:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
    fi
}

function WebTest_MetaAI() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.meta.ai/' -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Meta AI:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'AbraGeoBlockedErrorRoot')
    local isOK=$(echo "$tmpresult" | grep -i 'AbraHomeRootConversationQuery')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Meta AI:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r Meta AI:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    if [ -n "$isOK" ]; then
        local region=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}"\K[^"]+' | cut -d'_' -f2)
        echo -n -e "\r Meta AI:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Meta AI:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function RegionTest_Bing() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://www.bing.com/search?q=curl' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Bing Region:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isCN=$(echo "$tmpresult" | grep 'cn.bing.com')
    local region=$(echo "$tmpresult" | grep -woP 'Region\s{0,}:\s{0,}"\K[^"]+')

    if [ -n "$isCN" ]; then
        local region='CN'
        echo -n -e "\r Bing Region:\t\t\t\t${Font_Yellow}${region}${Font_Suffix}\n"
        return
    fi

    local isRisky=$(echo "$tmpresult" | grep 'sj_cook.set("SRCHHPGUSR","HV"')

    if [ -n "$isRisky" ]; then
        echo -n -e "\r Bing Region:\t\t\t\t${Font_Yellow}${region} (Risky)${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Bing Region:\t\t\t\t${Font_Green}${region}${Font_Suffix}\n"
}

function WebTest_Wikipedia_Editable() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://zh.wikipedia.org/w/index.php?title=Wikipedia%3A%E6%B2%99%E7%9B%92&action=edit' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Wikipedia Editability:\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -i 'Banned')
    if [ -z "$result" ]; then
        echo -n -e "\r Wikipedia Editability:\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Wikipedia Editability:\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_K_PLUS() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r K+:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local token=$(curl ${CURL_DEFAULT_OPTS} -s -H "Origin: https://xem.kplus.vn" -H "Referer: https://xem.kplus.vn/" -X POST -d '{"osVersion":"Windows NT 10.0","appVersion":"114.0.0.0","deviceModel":"Chrome","deviceType":"PC","deviceSerial":"w39db81c0-a2e9-11ed-952a-49b91c9e6f09","deviceOem":"Chrome","devicePrettyName":"Chrome","ssoToken":"eyJrZXkiOiJ2c3R2IiwiZW5jIjoiQTEyOENCQy1IUzI1NiIsImFsZyI6ImRpciJ9..MWbBlLuci2KNLl9lvMe63g.IbBX7-dg3BWaXzzoxTQz-pJFulm_Y8axWLuG5DcJxQ9jTUPOhA2e6dzOP2hryAFVPFoIRs97ONGTHEYTFQgUtRlvqvx53jyTi3yegU6zWhJnhYZA2sdaj9khsNvVAth0zcWFoWA9GGwfNE5TZLOwczAexIxqC1Ee-tQDILC4XklFrJfvdzoCQBABRXpD_O4HHHIYFs0jBMtYSyD9Vq7dTD61sAVca_83lav7jvpP17PuAo3HHIFQtUdcugpgkB91mJbABIDTPdo0mqdzbgTA_FilwO1Z5qnpwqIZIXy0bhVXFFcwUZPIUxjLEVzP3SyHceFF5N-v7OeYhYZRLYuBKxWj1cRb3LAa3FGJvefqRsBadlsr0cZnOgx0TsL51a2SaIpNyyGtaq8KTTLULIZBb2Zsq2jmBkZtxjoPxUR8ku7J4sL0tfLDoMlWVZkrX4_1tls3E-l8Ael-wd0kbS1i2vpf-Vdh80lRClpDg3ibSSUFPsp3wYMFsuKfyY8vpHrCfYDJDDbYOSv20sfnU7q7gcmizTCFBuiszmXbFX9_aH8UOaCGeqkYDV1ZZ3mQ26TM7JEquuZTV09wdi81ABoM8RZcb2ua0cuocaO4-asMh8KQWNea9BCYlKK5NSPz--oGgGxSdvxZ63qQz1Lr4QZytA2buoQV5OlMoEP7k87fPcig5rPqsK7aeWUXJSmfiOBbSLztoiamvvHClMpds3frv0ud8NWUUoijmS_JUGfF7XYNxWWqEGJuDUoSllV5MVwtIb5wM069gR7zknrr5aRVDi3Nho16KHQ_iB3vxoIr-ExajWLNlvo44CopGhxhgOAKPkULV356uamZpB7twY_iEVrwGMQA1_hEH4usO-UbzuxL_pssLhJKD4NjVcTe86Z08Bfm0IyiNWESmFkA6FVfsxu57Yfd4bXT8mxnfXXmklb7u7vB0RVYRo4i26QGJbPknybHdfgQWEvRCMoAjEG-E2LymBAMwFneWEpPTwBMpfvlTHnGnUtfViA4Zy1xqF2q95g9AF9nF3sE4YpYuSFSkUQB4sZd8emDApIdP6Avqsq809Gg06_R2sUGrD9SQ-XbXhvtAYMcaUcSv54hJvRcSUkygqU8tdg4tJHR23UBb-I.UfpC5BKhvt8EE5gpIFMQoQ","brand":"vstv","environment":"p","language":"en_US","memberId":"0","featureLevel":4,"provisionData":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYyI6dHJ1ZSwiaWF0IjoxNjg2NTc4NzYyLCJ1cCI6ImNwaSIsImRlIjoiYnJhbmRNYXBwaW5nIiwiYnIiOiJ2c3R2IiwiZHMiOiJ3MzlkYjgxYzAtYTJlOS0xMWVkLTk1MmEtNDliOTFjOWU2ZjA5In0.3mbI7wnJKtRf3493yc_ZEMEvzUXldwDx0sSZdwQnlNk"}' "https://tvapi-sgn.solocoo.tv/v1/session" |  grep -woP '"token"\s{0,}:\s{0,}"\K[^"]+' | awk '{print $2}' | cut -f2 -d'"')
    if [ -z "$token" ]; then
        echo -n -e "\r K+:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s -X POST -d '{"player":{"name":"RxPlayer","version":"3.29.0","capabilities":{"mediaTypes":["DASH","DASH"],"drmSystems":["PlayReady","Widevine"],"smartLib":true}}}' -H "Content-Type: application/json" -H "Authorization: Bearer $token" "https://tvapi-sgn.solocoo.tv/v1/assets/BJO0h8jMwJWg5Id_4VLxIJ-VscUzRry_myp4aC21/play")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r K+:\t\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep 'geoblock')

    if [ -n "$result" ]; then
        echo -n -e "\r K+:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r K+:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
}

function MediaUnlockTest_TV360() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r TV360:\t\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'http://api-v2.tv360.vn/public/v1/composite/get-link?childId=998335&device_type=WEB_IPHONE&id=19474&network_device_id=prIUMaumjI7dNWKSUxFkEViFygs%3D&t=1686572228&type=film' -H "userid: 182551343" -H "devicetype: WEB_IPHONE" -H "deviceName: iPad Air 5th Gen (WiFi)" -H "profileid: 182733455" -H "s: cSkV/vwUfX6tahDwe6xh9Bl0yhNs/TdWTaOJiWDt3gHekijGnNYh9i4YaUmdfBfI4oKOwvioKJ7PuKMH7ctWA6rEHeGXH/nUYOY1g7l4Umh6zoed5bBwWCgUuh5eMqdNNoptwaeCee58USTteOkbHQ==" -H "deviceid: 69FFABD6-F9D8-4C2E-8C44-7195CF0A2930" -H "devicedrmid: prIUMaumjI7dNWKSUxFkEViFygs=" -H "Authorization: Bearer eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiIxODI1NTEzNDMiLCJ1c2VySWQiOjE4MjU1MTM0MywicHJvZmlsZUlkIjoxODI3MzM0NTUsImR2aSI6MjY5NDY3MTUzLCJjb250ZW50RmlsdGVyIjoiMTAwIiwiZ25hbWUiOiIiLCJpYXQiOjE2ODY1NzIyMDEsImV4cCI6MTY4NzE3NzAwMX0.oi0BKvATgBzPEkqR_liBrvMKXBUiWzp2BQme-biDnwiVhuta0qn_aZo6z3azLdjW5kH6PfEwEkc4K9jCfAK5rw" -H "osappversion: 1.9.27" -H "sessionid: C5017358-5327-4185-999A-CA3291CC66AC" -H "zoneid: 1" -H "Accept: application/json, text/html" -H "Content-Type: application/json" -H "osapptype: IPAD" -H "tv360transid: 1686572228_69FFABD6-F9D8-4C2E-8C44-7195CF0A2930" -H "User-Agent: TV360/31 CFNetwork/1402.0.8 Darwin/22.2.0")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r TV360:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -woP '"errorCode"\s{0,}:\s{0,}\K\d+')

    case "$result" in
        '310') echo -n -e "\r TV360:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        '200') echo -n -e "\r TV360:\t\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r TV360:\t\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_MeWatch() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r MeWatch:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://cdn.mewatch.sg/api/items/97098/videos?delivery=stream%2Cprogressive&ff=idp%2Cldp%2Crpt%2Ccd&lang=en&resolution=External&segments=all' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r MeWatch:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -woP '"code"\s{0,}:\s{0,}\K\d+')
    local isOK=$(echo "$tmpresult" | grep -i 'Stream')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r MeWatch:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r MeWatch:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r MeWatch:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r MeWatch:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_trueID() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r trueID:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL "https://tv.trueid.net/th-en/live/thairathtv-hd" -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: same-origin' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r trueID:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    local channelId=$(echo "$tmpresult" | grep -woP '"channelId"\s{0,}:\s{0,}"\K[^"]+' | head -n 1)
    local authUser=$(echo "$tmpresult" | grep -woP '"buildId"\s{0,}:\s{0,}"\K[^"]+' | head -n 1)
    local authKey=${authUser:10}
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s "https://tv.trueid.net/api/stream/checkedPlay?channelId=${channelId}&lang=en&country=th" -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: same-origin' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' -u ${authUser}:${authKey} -H 'accept: application/json, text/plain, */*' -H 'referer: https://tv.trueid.net/th-en/live/thairathtv-hd' --user-agent "${UA_BROWSER}")

    local result=$(echo "$tmpresult2" | grep -woP '"billboardType"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        'GEO_BLOCK') echo -n -e "\r trueID:\t\t\t\t${Font_Red}No${Font_Suffix}\n" ;;
        'LOADING') echo -n -e "\r trueID:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        *) echo -n -e "\r trueID:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_SonyLiv() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.sonyliv.com/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r SonyLiv:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi
    local isBlocked=$(echo "$tmpresult" | grep 'geolocation_notsupported')
    if [ -n "$isBlocked" ]; then
        echo -n -e "\r SonyLiv:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    # 取得 JWT Token
    local jwtToken=$(echo "$tmpresult" | grep 'securityToken' | sed 's/.*securityToken//' | sed 's/.*resultObj//' | cut -f2 -d'"' | head -n 1)
    # 取得国家代码
    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s 'https://apiv2.sonyliv.com/AGL/1.4/A/ENG/WEB/ALL/USER/ULD' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'accept: application/json, text/plain, */*' -H 'referer: https://www.sonyliv.com/' -H 'device_id: 25a417c3b5f246a393fadb022adc82d5-1715309762699' -H 'app_version: 3.5.59' -H "security_token: ${jwtToken}" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r SonyLiv:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi
    local region=$(echo "$tmpresult2" |  grep -woP '"country_code"\s{0,}:\s{0,}"\K[^"]+')
    # 取得播放详情
    local tmpresult3=$(curl ${CURL_DEFAULT_OPTS} -s "https://apiv2.sonyliv.com/AGL/3.8/A/ENG/WEB/${region}/ALL/CONTENT/VIDEOURL/VOD/1000045427/prefetch" -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: same-origin' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' -H 'accept: application/json, text/plain, */*' -H 'origin: https://www.sonyliv.com' -H 'referer: https://www.sonyliv.com/' -H 'device_id: 25a417c3b5f246a393fadb022adc82d5-1715309762699' -H "security_token: ${jwtToken}" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult3" ]; then
        echo -n -e "\r SonyLiv:\t\t\t\t${Font_Red}Failed (Network Connection 2)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult3" | grep -woP '"resultCode"\s{0,}:\s{0,}"\K[^"]+')
    local reason=$(echo "$tmpresult3" | grep -woP '"message"\s{0,}:\s{0,}"\K[^"]+')
    case "$result" in
        "KO") echo -n -e "\r SonyLiv:\t\t\t\t${Font_Red}No (${reason})${Font_Suffix}\n" ;;
        "OK") echo -n -e "\r SonyLiv:\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n" ;;
        *) echo -n -e "\r SonyLiv:\t\t\t\t${Font_Red}Failed (Error: ${result})${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_JioCinema() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s 'https://apis-jiocinema.voot.com/location' -H 'Accept: application/json, text/plain, */*' -H 'Accept-Language: en-US,en;q=0.9' -H 'Origin: https://www.jiocinema.com' -H 'Referer: https://www.jiocinema.com/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: cross-site' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Jio Cinema:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local tmpresult2=$(curl ${CURL_DEFAULT_OPTS} -s 'https://content-jiovoot.voot.com/psapi/voot/v1/voot-web//view/show/3500210?subNavId=38fa57ba_1706064514668&excludeTray=player-tray,subnav&responseType=common&devicePlatformType=desktop&page=1&layoutCohort=default&supportedChips=comingsoon' -X 'OPTIONS' -H 'Accept: */*' -H 'Accept-Language: en-US,en;q=0.9' -H 'Access-Control-Request-Headers: app-version' -H 'Access-Control-Request-Method: GET' -H 'Origin: https://www.jiocinema.com' -H 'Referer: https://www.jiocinema.com/' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: cross-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult2" ]; then
        echo -n -e "\r Jio Cinema:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local isBlocked1=$(echo "$tmpresult" | grep -i 'Access Denied')
    local isOK1=$(echo "$tmpresult" | grep -i 'Success')
    local isBlocked2=$(echo "$tmpresult2" | grep -i 'is unavailable at your')
    local isOK2=$(echo "$tmpresult2" | grep -i 'Ok')

    if [ -n "$isBlocked1" ] || [ -n "$isBlocked2" ]; then
        echo -n -e "\r Jio Cinema:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK1" ] && [ -n "$isOK2" ]; then
        echo -n -e "\r Jio Cinema:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Jio Cinema:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_MXPlayer() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r MX Player:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sLi 'https://www.mxplayer.in/' -w "_TAG_%{http_code}_TAG_" --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r MX Player:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isOK=$(echo "$tmpresult" | grep 'set-cookie')
    local isBlocked=$(echo "$tmpresult" | grep -iE '403 ERROR|not available in your')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r MX Player:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -n "$isOK" ]; then
        echo -n -e "\r MX Player:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r MX Player:\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function MediaUnlockTest_Zee5() {
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sLi 'https://www.zee5.com/' -w "_TAG_%{http_code}_TAG_" -H 'Upgrade-Insecure-Requests: 1' --user-agent "${UA_BROWSER}")
    local httpCode=$(echo "$tmpresult" | grep '_TAG_' | awk -F'_TAG_' '{print $2}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r Zee5:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local region=$(echo "$tmpresult" | grep -woP 'country=\K[A-Z]{2}' | head -n 1)
    if [ -n "$region" ]; then
        echo -n -e "\r Zee5:\t\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r Zee5:\t\t\t\t\t${Font_Red}Failed (Error: Unknown)${Font_Suffix}\n"
}

function WebTest_EroGameSpace() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r EroGameSpace:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL "https://erogamescape.org" --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r EroGameSpace:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local result=$(echo "$tmpresult" | grep -i '18歳')
    if [ -n "$result" ]; then
        echo -n -e "\r EroGameSpace:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r EroGameSpace:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
}

function MediaUnlockTest_DAnimeStore() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r D Anime Store:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local tmpresult=$(OPENSSL_CONF=<(cat <<EOF
openssl_conf = openssl_init
[openssl_init]
ssl_conf = ssl_sect
[ssl_sect]
system_default = system_default_sect
[system_default_sect]
Options = UnsafeLegacyServerConnect
EOF
) curl ${CURL_DEFAULT_OPTS} -sL 'https://animestore.docomo.ne.jp/animestore/reg_pc' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r D Anime Store:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep '海外')
    if [ -n "$isBlocked" ];then
        echo -n -e "\r D Anime Store:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r D Anime Store:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n"
}

function MediaUnlockTest_RakutenTVJP() {
    if [ "${USE_IPV6}" == 1 ]; then
        echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Red}IPv6 Is Not Currently Supported${Font_Suffix}\n"
        return
    fi

    local contentId='387878'
    local tmpresult=$(curl ${CURL_DEFAULT_OPTS} -s "https://api-live.tv.rakuten.co.jp/v1/contents/${contentId}/playinfo?device_id=2" -H 'accept: application/json, text/plain, */*' -H 'accept-language: en-US,en;q=0.9' -H 'origin: https://live.tv.rakuten.co.jp' -H 'referer: https://live.tv.rakuten.co.jp/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local isBlocked=$(echo "$tmpresult" | grep -i 'IS_FOREIGN')
    if [ -n "$isBlocked" ];then
        echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi

    local isOK=$(echo "$tmpresult" | grep -i 'in_vod')

    if [ -z "$isBlocked" ] && [ -z "$isOK" ]; then
        echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR)${Font_Suffix}\n"
        return
    fi

    local tmpresult1=$(curl ${CURL_DEFAULT_OPTS} -s 'https://webapi.nba.rakuten.co.jp/api/v1/system/geofilter?os_type=web&os_version=2.38.13' -H 'accept: application/json, text/plain, */*' -H 'accept-language: ja' -H 'origin: https://nba.rakuten.co.jp' -H 'referer: https://nba.rakuten.co.jp/' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: empty' -H 'sec-fetch-mode: cors' -H 'sec-fetch-site: same-site' --user-agent "${UA_BROWSER}")
    if [ -z "$tmpresult" ]; then
        echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Red}Failed (Network Connection 1)${Font_Suffix}\n"
        return
    fi

    local isDomestic=$(echo "$tmpresult1" | grep -woP '"is_domestic"\s{0,}:\s{0,}\K(false|true)')

    case "$isDomestic" in
        'false') echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Yellow}No (NBA Unavailable)${Font_Suffix}\n" ;;
        'true') echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Green}Yes${Font_Suffix}\n" ;;
        '') echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Red}Failed (Error: PAGE ERROR 1)${Font_Suffix}\n" ;;
        *) echo -n -e "\r Rakuten TV JP:\t\t\t\t${Font_Red}Failed (Error: $result)${Font_Suffix}\n" ;;
    esac
}

function MediaUnlockTest_AMCPlus() {
    tmpresult=$(curl ${CURL_DEFAULT_OPTS} -sL 'https://www.amcplus.com/' -w '%{http_code}_TAG_%{url_effective}\n' -o dev/null -H 'accept: */*;q=0.8,application/signed-exchange;v=b3;q=0.7' -H 'accept-language: en-US,en;q=0.9' -H "sec-ch-ua: ${UA_SEC_CH_UA}" -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' -H 'sec-fetch-dest: document' -H 'sec-fetch-mode: navigate' -H 'sec-fetch-site: none' -H 'sec-fetch-user: ?1' -H 'upgrade-insecure-requests: 1' --user-agent "${UA_BROWSER}")

    local httpCode=$(echo "$tmpresult" | awk -F'_TAG_' '{print $1}')
    if [ "$httpCode" == '000' ]; then
        echo -n -e "\r AMC+:\t\t\t\t\t${Font_Red}Failed (Network Connection)${Font_Suffix}\n"
        return
    fi

    local urlEffective=$(echo "$tmpresult" | awk -F'_TAG_' '{print $2}')
    local isBlocked=$(echo "$urlEffective" | grep -i 'geographic-restriction')
    local region=$(echo "$urlEffective" | awk -F'/' '{print $NF}' | tr A-Z a-z | sed 's/\b[a-z]/\U&/g')

    if [ -n "$isBlocked" ]; then
        echo -n -e "\r AMC+:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ "$httpCode" == '403' ]; then
        echo -n -e "\r AMC+:\t\t\t\t\t${Font_Red}No${Font_Suffix}\n"
        return
    fi
    if [ -z "$region" ]; then
        local region='USA'
    fi
    if [ "$httpCode" == '200' ]; then
        echo -n -e "\r AMC+:\t\t\t\t\t${Font_Green}Yes (Region: ${region})${Font_Suffix}\n"
        return
    fi

    echo -n -e "\r AMC+:\t\t\t\t\t${Font_Red}Failed (Error: ${httpCode})${Font_Suffix}\n"
}

function echo_result() {
    for ((i=0;i<${#array[@]};i++)); do
        echo "$result" | grep "${array[i]}"
        delay 0.03
    done
}

function Global_UnlockTest() {
    echo ""
    echo "============[ Multination ]============"
    local result=$(
        MediaUnlockTest_Dazn &
        MediaUnlockTest_DisneyPlus &
        MediaUnlockTest_Netflix &
        MediaUnlockTest_YouTube_Premium &
        MediaUnlockTest_PrimeVideo &
        MediaUnlockTest_TVBAnywhere &
        MediaUnlockTest_Spotify &
        RegionTest_oneTrust &
        RegionTest_iQYI &
    )
    wait
    local array=("Dazn:" "Disney+:" "Netflix:" "YouTube Premium:" "Amazon Prime Video:" "TVBAnywhere+:" "Spotify Registration:" "OneTrust Region:" "iQyi Oversea Region:")
    echo_result ${result} ${array}
    local result=$(
        RegionTest_Bing &
        RegionTest_Apple &
        RegionTest_YouTubeCDN &
        RegionTest_NetflixCDN &
        WebTest_OpenAI &
        WebTest_Gemini &
        WebTest_Claude &
        WebTest_Wikipedia_Editable &
        WebTest_GooglePlayStore &
        WebTest_GoogleSearchCAPTCHA &
        GameTest_Steam &
    )
    wait
    local array=("Bing Region:" "Apple Region:" "YouTube CDN:" "Netflix Preferred CDN:" "ChatGPT:" "Google Gemini:" "Claude:" "Wikipedia Editability:" "Google Play Store:" "Google Search CAPTCHA Free:" "Steam Currency:")
    echo_result ${result} ${array}
    show_region Forum
    WebTest_Reddit
    echo "======================================="
}

function NA_UnlockTest() {
    echo "===========[ North America ]==========="
    local result=$(
        MediaUnlockTest_ParamountPlus &
        MediaUnlockTest_DiscoveryPlus &
        MediaUnlockTest_AcornTV &
        MediaUnlockTest_BritBox &
        MediaUnlockTest_SonyLiv &
        MediaUnlockTest_NBATV &
        MediaUnlockTest_TLCGO &
        MediaUnlockTest_Shudder &
        MediaUnlockTest_FuboTV &
        MediaUnlockTest_TubiTV &
    )
    wait
    local array=("Paramount+:" "Discovery+:" "Acorn TV:" "BritBox:" "SonyLiv:" "NBA TV:" "TLC GO:" "Shudder:" "Fubo TV:" "Tubi TV:")
    echo_result ${result} ${array}
    local result=$(
        MediaUnlockTest_PlutoTV &
        MediaUnlockTest_KOCOWA &
        MediaUnlockTest_AMCPlus &
        GameTest_MathsSpot &
    )
    wait
    local array=("Pluto TV:" "KOCOWA:" "AMC+" "MathsSpot Roblox:")
    echo_result ${result} ${array}
    show_region US
    local result=$(
        MediaUnlockTest_Fox &
        MediaUnlockTest_HuluUS &
        MediaUnlockTest_NFLPlus &
        MediaUnlockTest_ESPNPlus &
        MediaUnlockTest_EPIX &
        MediaUnlockTest_Starz &
        MediaUnlockTest_Philo &
        MediaUnlockTest_FXNOW &
        MediaUnlockTest_HBOMax &
    )
    wait
    local array=("FOX:" "Hulu:" "NFL+" "ESPN+:" "MGM+:" "Starz:" "Philo:" "FXNOW:" "HBO Max:")
    echo_result ${result} ${array}
    local result=$(
        MediaUnlockTest_Crackle &
        MediaUnlockTest_CWTV &
        MediaUnlockTest_AETV &
        MediaUnlockTest_NBCTV &
        MediaUnlockTest_SlingTV &
        MediaUnlockTest_encoreTVB &
    )
    wait
    local array=("Crackle:" "CW TV:" "A&E TV:" "NBC TV:" "Sling TV:" "encoreTVB:")
    echo_result ${result} ${array}
    local result=$(
        MediaUnlockTest_PeacockTV &
        MediaUnlockTest_Popcornflix &
        MediaUnlockTest_Crunchyroll &
        MediaUnlockTest_Directv &
        # MediaUnlockTest_KBSAmerican &
        WebTest_MetaAI &
    )
    wait
    local array=("Peacock TV:" "Popcornflix:" "Crunchyroll:" "Directv Stream:" "Meta AI:")
    echo_result ${result} ${array}
    show_region CA
    local result=$(
        MediaUnlockTest_HotStar &
        MediaUnlockTest_CBCGem &
        MediaUnlockTest_Crave &
    )
    wait
    local array=("HotStar:" "CBC Gem:" "Crave:")
    echo_result ${result} ${array}
    echo "======================================="
}

function EU_UnlockTest() {
    echo "===============[ Europe ]=============="
    local result=$(
        MediaUnlockTest_ParamountPlus &
        MediaUnlockTest_DiscoveryPlus &
        MediaUnlockTest_SonyLiv &
        MediaUnlockTest_HBOMax &
        MediaUnlockTest_SkyShowTime &
        MediaUnlockTest_BritBox &
        MediaUnlockTest_RakutenTV &
        MediaUnlockTest_MegogoTV &
        MediaUnlockTest_SetantaSports &
        GameTest_MathsSpot &
    )
    wait
    local array=("Paramount+:" "Discovery+:" "SonyLiv:" "HBO Max:" "SkyShowTime:" "BritBox:" "Rakuten TV:" "Megogo TV:" "Setanta Sports:" "MathsSpot Roblox:")
    echo_result ${result} ${array}
    show_region GB
    local result=$(
        MediaUnlockTest_HotStar &
        MediaUnlockTest_SkyGo &
        MediaUnlockTest_ITVHUB &
        MediaUnlockTest_Channel4 &
        MediaUnlockTest_Channel5 &
        MediaUnlockTest_BBCiPLAYER &
        MediaUnlockTest_AcornTV &
        MediaUnlockTest_Shudder &
    )
    wait
    local array=("HotStar:" "Sky Go:" "ITV Hub:" "Channel 4:" "Channel 5:" "BBC iPLAYER:" "Acorn TV:" "Shudder:")
    echo_result ${result} ${array}
    show_region FR
    local result=$(
        MediaUnlockTest_CanalPlus &
        MediaUnlockTest_Molotov &
    )
    wait
    local array=("Canal+:" "Molotov:")
    echo_result ${result} ${array}
    show_region DE
    local result=$(
        MediaUnlockTest_Joyn &
        MediaUnlockTest_SKY_DE &
        MediaUnlockTest_ZDF &
    )
    wait
    local array=("Joyn:" "SKY DE:" "ZDF:")
    echo_result ${result} ${array}
    show_region NL
    local result=$(
        MediaUnlockTest_NLZIET &
        MediaUnlockTest_videoland &
        MediaUnlockTest_NPO_Start_Plus &
    )
    wait
    local array=("NLZIET:" "videoland:" "NPO Start Plus:")
    echo_result ${result} ${array}
    local result=$(
        MediaUnlockTest_MoviStarPlus &
        MediaUnlockTest_RaiPlay &
        MediaUnlockTest_Sky_CH &
        MediaUnlockTest_Amediateka &
    )
    wait
    show_region ES
    echo "$result" | grep "Movistar+:"
    show_region IT
    echo "$result" | grep "Rai Play:"
    show_region CH
    echo "$result" | grep "SKY CH:"
    show_region RU
    echo "$result" | grep "Amediateka:"
    echo "======================================="
}

function HK_UnlockTest() {
    echo "=============[ Hong Kong ]============="
    local result=$(
        MediaUnlockTest_NowE &
        MediaUnlockTest_ViuCom &
        MediaUnlockTest_ViuTV &
        MediaUnlockTest_MyTVSuper &
        MediaUnlockTest_HBOMax &
        MediaUnlockTest_SonyLiv &
        MediaUnlockTest_BilibiliHKMCTW &
        MediaUnlockTest_BahamutAnime &
    )
    wait
    local array=("Now E:" "Viu.com:" "Viu.TV:" "MyTVSuper:" "HBO Max:" "SonyLiv:" "BiliBili Hongkong/Macau/Taiwan:" "Bahamut Anime:")
    echo_result ${result} ${array}
    echo "======================================="
}

function AF_UnlockTest() {
    echo "==============[ Africa ]=============="
    local result=$(
        MediaUnlockTest_DSTV &
        MediaUnlockTest_Showmax &
        MediaUnlockTest_ViuCom &
        # MediaUnlockTest_ParamountPlus &
    )
    wait
    local array=("DSTV:" "Showmax:" "Viu.com:")
    echo_result ${result} ${array}
    echo "======================================="
}

function IN_UnlockTest() {
    echo "===============[ India ]==============="
    local result=$(
        MediaUnlockTest_HotStar &
        MediaUnlockTest_Zee5 &
        MediaUnlockTest_SonyLiv &
        MediaUnlockTest_JioCinema &
        MediaUnlockTest_MXPlayer &
        MediaUnlockTest_NBATV &
    )
    wait
    local array=("HotStar:" "Zee5:" "SonyLiv:" "Jio Cinema:" "MX Player:" "NBA TV:")
    echo_result ${result} ${array}
    echo "======================================="
}

function TW_UnlockTest() {
    echo "==============[ Taiwan ]==============="
    local result=$(
        MediaUnlockTest_KKTV &
        MediaUnlockTest_LiTV &
        MediaUnlockTest_MyVideo &
        MediaUnlockTest_4GTV &
        MediaUnlockTest_LineTVTW &
        MediaUnlockTest_HamiVideo &
        MediaUnlockTest_Catchplay &
        MediaUnlockTest_HBOMax &
        MediaUnlockTest_BahamutAnime &
        MediaUnlockTest_SonyLiv &
        MediaUnlockTest_BilibiliTW &
    )
    wait
    local array=("KKTV:" "LiTV:" "MyVideo:" "4GTV.TV:" "LineTV.TW:" "Hami Video:" "CatchPlay+:" "HBO Max:" "Bahamut Anime:" "SonyLiv:" "Bilibili Taiwan Only:")
    echo_result ${result} ${array}
    echo "======================================="
}

function JP_UnlockTest() {
    echo "===============[ Japan ]==============="
    local result=$(
        MediaUnlockTest_DMM &
        MediaUnlockTest_DMMTV &
        MediaUnlockTest_AbemaTV &
        MediaUnlockTest_Niconico &
        MediaUnlockTest_Telasa &
        MediaUnlockTest_unext &
        MediaUnlockTest_HuluJP &
        MediaUnlockTest_TVer &
        MediaUnlockTest_Lemino &
        MediaUnlockTest_AnimeFesta &
        MediaUnlockTest_wowow &
    )
    wait
    local array=("DMM:" "DMM TV:" "Abema.TV:" "Niconico:" "Telasa:" "U-NEXT:" "Hulu Japan:" "TVer:" "Lemino:" "AnimeFesta:" "WOWOW:")
    echo_result ${result} ${array}
    local result=$(
        MediaUnlockTest_VideoMarket &
        MediaUnlockTest_DAnimeStore &
        MediaUnlockTest_FOD &
        MediaUnlockTest_Radiko &
        MediaUnlockTest_DAM &
        MediaUnlockTest_JCOM_ON_DEMAND &
        MediaUnlockTest_Watcha &
        MediaUnlockTest_RakutenTVJP &
    )
    wait
    local array=("VideoMarket:" "D Anime Store:" "FOD(Fuji TV):" "Radiko:" "Karaoke@DAM:" "J:com On Demand:" "WATCHA:" "Rakuten TV JP:")
    echo_result ${result} ${array}
    show_region Game
    local result=$(
        GameTest_Kancolle &
        GameTest_UMAJP &
        GameTest_KonosubaFD &
        GameTest_PCRJP &
        GameTest_ProjectSekai &
    )
    wait
    local array=("Kancolle Japan:" "Pretty Derby Japan:" "Konosuba Fantastic Days:" "Princess Connect Re:Dive Japan:" "Project Sekai: Colorful Stage:")
    echo_result ${result} ${array}
    show_region Music
    local result=$(
        MediaUnlockTest_mora &
        MediaUnlockTest_musicjp &
    )
    wait
    local array=("Mora:" "music.jp:")
    echo_result ${result} ${array}
    show_region Forum
    WebTest_EroGameSpace
    echo "======================================="

}

function SA_UnlockTest() {
    echo "===========[ South America ]==========="
    local result=$(
        MediaUnlockTest_HBOMax &
        MediaUnlockTest_DirecTVGO &
        MediaUnlockTest_ParamountPlus &
    )
    wait
    local array=("Star+:" "HBO Max:" "DirecTV Go:" "Paramount+:")
    echo_result ${result} ${array}
    echo "======================================="
}

function OA_UnlockTest() {
    echo "==============[ Oceania ]=============="
    local result=$(
        MediaUnlockTest_NBATV &
        MediaUnlockTest_AcornTV &
        MediaUnlockTest_BritBox &
        MediaUnlockTest_ParamountPlus &
        MediaUnlockTest_AMCPlus &
        MediaUnlockTest_SonyLiv &
    )
    wait
    local array=("NBA TV:" "Acorn TV:" "BritBox:" "Paramount+:" "AMC+" "SonyLiv:")
    echo_result ${result} ${array}
    show_region AU
    local result=$(
        # MediaUnlockTest_Stan &
        MediaUnlockTest_Binge &
        MediaUnlockTest_Docplay &
        MediaUnlockTest_7plus &
        MediaUnlockTest_ABCiView &
    )
    wait
    local array=("Binge:" "Docplay:" "7plus:" "ABC iView:")
    echo_result ${result} ${array}
    local result=$(
        MediaUnlockTest_Channel9 &
        MediaUnlockTest_Channel10 &
        MediaUnlockTest_OptusSports &
        MediaUnlockTest_SBSonDemand &
        MediaUnlockTest_KayoSports &
    )
    wait
    local array=("Channel 9:" "Channel 10:" "Optus Sports:" "SBS on Demand:" "Kayo Sports:")
    echo_result ${result} ${array}
    show_region NZ
    local result=$(
        MediaUnlockTest_NeonTV &
        MediaUnlockTest_SkyGONZ &
        MediaUnlockTest_ThreeNow &
        MediaUnlockTest_MaoriTV &
    )
    wait
    local array=("Neon TV:" "SkyGo NZ:" "ThreeNow:" "Maori TV:")
    echo_result ${result} ${array}
    echo "======================================="
}

function KR_UnlockTest() {
    echo "==============[ Korean ]==============="
    local result=$(
        MediaUnlockTest_Wavve &
        MediaUnlockTest_Tving &
        MediaUnlockTest_Watcha &
        MediaUnlockTest_CoupangPlay &
        MediaUnlockTest_SpotvNow &
        MediaUnlockTest_NaverTV &
        MediaUnlockTest_Afreeca &
        MediaUnlockTest_KBSDomestic &
    )
    wait
    local array=("Wavve:" "Tving:" "WATCHA:" "Coupang Play:" "Naver TV:" "SPOTV NOW" "Afreeca TV:" "KBS Domestic:")
    echo_result ${result} ${array}
    echo "======================================="
}

function SEA_UnlockTest() {
    echo "==========[ SouthEastAsia ]============"
    local result=$(
        MediaUnlockTest_ViuCom &
        MediaUnlockTest_HotStar &
        MediaUnlockTest_HBOMax &
        MediaUnlockTest_SonyLiv &
        MediaUnlockTest_BGlobalSEA &
    )
    wait
    local array=("Viu.com:" "HotStar:" "HBO Max:" "SonyLiv:" "B-Global SouthEastAsia:")
    echo_result ${result} ${array}

    show_region SG
    local result=$(
        MediaUnlockTest_MeWatch &
    )
    wait
    local array=("MeWatch:")
    echo_result ${result} ${array}

    show_region TH
    local result=$(
        MediaUnlockTest_AISPlay &
        MediaUnlockTest_trueID &
        MediaUnlockTest_BGlobalTH &
    )
    wait
    local array=("AIS Play:" "trueID:" "B-Global Thailand Only:")
    echo_result ${result} ${array}

    show_region ID
    local result=$(
        MediaUnlockTest_BGlobalID &
    )
    wait
    local array=("B-Global Indonesia Only:")
    echo_result ${result} ${array}
    show_region VN
    local result=$(
        # MediaUnlockTest_K_PLUS &
        # MediaUnlockTest_TV360 &
        MediaUnlockTest_BGlobalVN &
    )
    wait
    local array=("B-Global Việt Nam Only:")
    echo_result ${result} ${array}
    echo "======================================="
}

function Sport_UnlockTest() {
    echo "===============[ Sport ]==============="
    local result=$(
        MediaUnlockTest_Dazn &
        MediaUnlockTest_ESPNPlus &
        MediaUnlockTest_NBATV &
        MediaUnlockTest_FuboTV &
        MediaUnlockTest_MolaTV &
        MediaUnlockTest_SetantaSports &
        MediaUnlockTest_OptusSports &
        MediaUnlockTest_BeinConnect &
        MediaUnlockTest_EurosportRO &
    )
    wait
    local array=("Dazn:" "Star+:" "ESPN+:" "NBA TV:" "Fubo TV:" "Mola TV:" "Setanta Sports:" "Optus Sports:" "Bein Sports Connect:" "Eurosport RO:")
    echo_result ${result} ${array}
    echo "======================================="
}

function showSupportOS() {
    if [ "$LANGUAGE" == 'en' ]; then
        echo -e "${Font_Purple}Supporting OS: Ubuntu 16+, Debian 10+, RHEL 7+, Arch Linux, Alpine Linux, FreeBSD, MacOS 10.13+, Android (Termux), iOS (iSH), Windows (MinGW/Cygwin), OpenWRT 23+ etc.${Font_Suffix}"
        echo ''
    else
        echo -e "${Font_Purple}脚本适配 OS: Ubuntu 16+, Debian 10+, RHEL 7+, Arch Linux, Alpine Linux, FreeBSD, MacOS 10.13+, Android (Termux), iOS (iSH), Windows (MinGW/Cygwin), OpenWRT 23+ 等。${Font_Suffix}"
        echo ''
    fi
}

function showScriptTitle() {
    if [ "$LANGUAGE" == 'en' ]; then
        echo -e " [Stream Platform & Game Region Restriction Test]"
        echo ''
        echo -e "${Font_Green}Github Repository:${Font_Suffix} ${Font_Yellow} https://github.com/lmc999/RegionRestrictionCheck ${Font_Suffix}"
        echo -e "${Font_Green}Telegram Discussion Group:${Font_Suffix} ${Font_Yellow} https://t.me/gameaccelerate ${Font_Suffix}"
        echo ''
        echo -e " ** Test Starts At: $(date)"
        echo -e " ** Version: ${VER}"
        echo ''
    else
        echo -e " [流媒体平台及游戏区域限制测试]"
        echo ''
        echo -e "${Font_Green}项目地址${Font_Suffix} ${Font_Yellow}https://github.com/lmc999/RegionRestrictionCheck ${Font_Suffix}"
        echo -e "${Font_Green}BUG 反馈或使用交流可加 TG 群组${Font_Suffix} ${Font_Yellow}https://t.me/gameaccelerate ${Font_Suffix}"
        echo ''
        echo -e " ** 测试时间: $(date)"
        echo -e " ** 版本: ${VER}"
        echo ''
    fi
}

function inputOptions() {

    while :; do
        if [ "$LANGUAGE" == 'en' ]; then
            echo -e "${Font_Blue}Please Select Test Region or Press ENTER to Test All Regions${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [1]: [ Multination + Taiwan ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [2]: [ Multination + Hong Kong ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [3]: [ Multination + Japan ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [4]: [ Multination + North America ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [5]: [ Multination + South America ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [6]: [ Multination + Europe ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [7]: [ Multination + Oceania ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [8]: [ Multination + Korean ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [9]: [ Multination + SouthEast Asia ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [10]: [ Multination + India ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [11]: [ Multination + Africa ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [0]: [ Multination Only ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number  [88]: [ Instagram Music ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number [99]: [ Sport Platforms ]${Font_Suffix}"
            echo -e "${Font_SkyBlue}Input Number [66]: [ All Platfroms ]${Font_Suffix}"
            read -p "Please Input the Correct Number or Press ENTER:" num
        else
            echo -e "${Font_Blue}请选择检测项目，直接按回车将进行全区域检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [1]: [ 跨国平台+台湾平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [2]: [ 跨国平台+香港平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [3]: [ 跨国平台+日本平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [4]: [ 跨国平台+北美平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [5]: [ 跨国平台+南美平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [6]: [ 跨国平台+欧洲平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [7]: [跨国平台+大洋洲平台]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [8]: [ 跨国平台+韩国平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [9]: [跨国平台+东南亚平台]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字 [10]: [ 跨国平台+印度平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字 [11]: [ 跨国平台+非洲平台 ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字  [0]: [   只进行跨国平台  ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字 [88]: [   Instagram音乐   ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字 [99]: [   体育直播平台    ]检测${Font_Suffix}"
            echo -e "${Font_SkyBlue}输入数字 [66]: [     全部平台      ]检测${Font_Suffix}"
            echo -e "${Font_Purple}输入数字 [69]: [   广告推广投放    ]咨询${Font_Suffix}"
            read -p "请输入正确数字或直接按回车:" num
        fi

        if [ -z "$num" ]; then
            REGION_ID=66
            break
        fi

        if ! validate_region_id "$num"; then
            echo -e "${Font_Red}请输入正确号码！${Font_Suffix}"
            echo -e "${Font_Red}Please enter the correct number!${Font_Suffix}"
            delay 3
            clear
            continue
        fi

        REGION_ID=$num
        break
    done
}

function checkPROXY() {
    local proxyType=$(echo "$USE_PROXY" | awk -F'://' '{print $1}' | tr a-z A-Z)

    if [ "$LANGUAGE" == 'en' ]; then
        echo -e " ${Font_SkyBlue}** Checking Results Under Proxy${Font_Suffix}"
        if ! check_proxy_connectivity; then
            echo -e " ${Font_SkyBlue}** Unable to connect to this Proxy${Font_Suffix}"
            exit 1
        fi
    else
        echo -e " ${Font_SkyBlue}** 正在测试代理解锁情况${Font_Suffix} "

        if ! check_proxy_connectivity; then
            echo -e " ${Font_SkyBlue}** 无法连接到此 ${proxyType} 代理${Font_Suffix}"
            exit 1
        fi
    fi
}

function showNetworkInfo() {
    echo '--------------------------------'
    get_ip_info
    if [ "$LANGUAGE" == 'en' ]; then
        echo -e " ${Font_SkyBlue}** Your Network Provider: ${LOCAL_ISP} (${LOCAL_IP_ASTERISK})${Font_Suffix} "
    else
        echo -e " ${Font_SkyBlue}** 您的网络为: ${LOCAL_ISP} (${LOCAL_IP_ASTERISK})${Font_Suffix}"
    fi
    echo ''
}

function checkIPConn() {
    if [ -z "$1" ]; then
        echo -e "${Font_Red}Param missing.${Font_Suffix}"
        exit 1
    fi

    if [ -z "$NETWORK_TYPE" ]; then
        local netType="$1"
    fi

    if [ -n "$NETWORK_TYPE" ]; then
        local netType="$NETWORK_TYPE"
    fi

    if [ "$1" == 4 ] && [ "$NETWORK_TYPE" == 6 ]; then
        return
    fi

    if [ "$1" == 6 ] && [ "$NETWORK_TYPE" == 4 ] ; then
        return
    fi

    if [ "$1" == 6 ] && [ "$NETWORK_TYPE" == 0 ]; then
        return
    fi

    if [ "$LANGUAGE" == 'en' ]; then
        if [ "$netType" == 4 ]; then
            echo ''
            echo -e " ${Font_SkyBlue}** Checking Results Under IPv4${Font_Suffix}"
            if ! check_net_connctivity 4 ; then
                echo -e "${Font_SkyBlue}No IPv4 Connectivity, IPv4 Test Skipped...${Font_Suffix}"
                USE_IPV4=0
                return
            fi

            USE_IPV4=1
            CURL_DEFAULT_OPTS="-4 ${CURL_OPTS}"
            showNetworkInfo
            return
        fi
        if [ "$netType" == 6 ]; then
            echo ''
            echo -e " ${Font_SkyBlue}** Checking Results Under IPv6${Font_Suffix}"
            if ! check_net_connctivity 6 ; then
                echo -e "${Font_SkyBlue}No IPv6 Connectivity, IPv6 Test Skipped...${Font_Suffix}"
                USE_IPV6=0
                return
            fi

            USE_IPV6=1
            CURL_DEFAULT_OPTS="-6 ${CURL_OPTS}"
            showNetworkInfo
            return
        fi
        if [ "$netType" == 0 ]; then
            echo ''
            echo -e " ${Font_SkyBlue}** Checking Results Under Default Network${Font_Suffix}"
            if check_net_connctivity 4; then
                local ipv4Support=1
            fi
            if check_net_connctivity 6; then
                local ipv6Support=1
            fi
            if [ "$ipv4Support" == 0 ] && [ "$ipv6Support" == 0 ]; then
                echo -e "${Font_Red}No network available, please check your network.${Font_Suffix}"
                USE_IPV4=0
                USE_IPV6=0
                exit 1
            fi
            # When IPv4 is supported, regardless IPv6 status
            if [ "$ipv4Support" == 1 ]; then
                USE_IPV4=1
                USE_IPV6=0
            fi
            # When IPv4 is not available, Use IPv6
            if [ "$ipv4Support" == 0 ] && [ "$ipv6Support" == 1 ]; then
                USE_IPV6=1
                USE_IPV4=0
            fi

            CURL_DEFAULT_OPTS="${CURL_OPTS}"
            showNetworkInfo
            return
        fi
    else
        if [ "$netType" == 4 ]; then
            echo ''
            echo -e " ${Font_SkyBlue}** 正在测试 IPv4 解锁情况${Font_Suffix}"
            if ! check_net_connctivity 4 ; then
                echo -e "${Font_SkyBlue}当前主机不支持 IPv4，跳过...${Font_Suffix}"
                USE_IPV4=0
                return
            fi

            USE_IPV4=1
            CURL_DEFAULT_OPTS="-4 ${CURL_OPTS}"
            showNetworkInfo
            return
        fi
        if [ "$netType" == 6 ]; then
            echo ''
            echo -e " ${Font_SkyBlue}** 正在测试 IPv6 解锁情况${Font_Suffix}"
            if ! check_net_connctivity 6 ; then
                echo -e "${Font_SkyBlue}当前主机不支持 IPv6，跳过...${Font_Suffix}"
                USE_IPV6=0
                return
            fi

            USE_IPV6=1
            CURL_DEFAULT_OPTS="-6 ${CURL_OPTS}"
            showNetworkInfo
            return
        fi
        if [ "$netType" == 0 ]; then
            echo ''
            echo -e " ${Font_SkyBlue}** 正在测试默认网络解锁情况${Font_Suffix}"
            if check_net_connctivity 4; then
                local ipv4Support=1
            fi
            if check_net_connctivity 6; then
                local ipv6Support=1
            fi
            if [ "$ipv4Support" == 0 ] && [ "$ipv6Support" == 0 ]; then
                echo -e "${Font_Red}当前无网络，请检查您的网络。${Font_Suffix}"
                USE_IPV4=0
                USE_IPV6=0
                exit 1
            fi
            # When IPv4 is supported, regardless IPv6 status
            if [ "$ipv4Support" == 1 ]; then
                USE_IPV4=1
                USE_IPV6=0
            fi
            # When IPv4 is not available, Use IPv6
            if [ "$ipv4Support" == 0 ] && [ "$ipv6Support" == 1 ]; then
                USE_IPV6=1
                USE_IPV4=0
            fi

            CURL_DEFAULT_OPTS="${CURL_OPTS}"
            showNetworkInfo
            return
        fi
    fi
}

function runScript() {
    showScriptTitle

    USE_IPV4=0
    USE_IPV6=0

    if [ "$REGION_ID" -eq 1 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            TW_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            TW_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 2 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            HK_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            HK_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 3 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            JP_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            JP_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 4 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            NA_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            NA_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 5 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            SA_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            SA_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 6 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            EU_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            EU_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 7 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            OA_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            OA_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 8 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            KR_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            KR_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 9 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            SEA_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            SEA_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 10 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            IN_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            IN_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 11 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            AF_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            AF_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 99 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Sport_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Sport_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 88 ]; then
        MediaUnlockTest_InstagramMusic
    fi
    if [ "$REGION_ID" -eq 0 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 66 ]; then
        checkIPConn 4
        if [ "$USE_IPV4" -eq 1 ]; then
            Global_UnlockTest
            TW_UnlockTest
            HK_UnlockTest
            JP_UnlockTest
            NA_UnlockTest
            SA_UnlockTest
            EU_UnlockTest
            OA_UnlockTest
            KR_UnlockTest
        fi
        checkIPConn 6
        if [ "$USE_IPV6" -eq 1 ]; then
            Global_UnlockTest
            TW_UnlockTest
            HK_UnlockTest
            JP_UnlockTest
            NA_UnlockTest
            SA_UnlockTest
            EU_UnlockTest
            OA_UnlockTest
            KR_UnlockTest
        fi
        return
    fi
    if [ "$REGION_ID" -eq 69 ]; then
        echo ''
        echo ''
        echo -e "${Font_Red}**************************${Font_Suffix}"
        echo -e "${Font_Red}*                        *${Font_Suffix}"
        echo -e "${Font_Red}*${Font_Suffix} 广告招租               ${Font_Red}*${Font_Suffix}"
        echo -e "${Font_Red}*${Font_Suffix} 请联系：@reidschat_bot ${Font_Red}*${Font_Suffix}"
        echo -e "${Font_Red}*                        *${Font_Suffix}"
        echo -e "${Font_Red}**************************${Font_Suffix}"
        return
    fi
}

function showGoodbye() {
    case "$NUM" in
        1) ADN='TW' ;;
        3) ADN='JP' ;;
        4) ADN='US' ;;
        8) ADN="KR" ;;
        *) ADN="$(echo $(($RANDOM % 2 + 1)))" ;;
    esac

    if [ "$LANGUAGE" == 'en' ]; then
        echo -e "${Font_Green}Testing Done! Thanks for Using This Script!${Font_Suffix}"
        echo -e ''
        echo -e "${Font_Yellow}Number of Script Runs for Today: ${TODAY_RUN_TIMES}; Total Number of Script Runs: ${TOTAL_RUN_TIMES}${Font_Suffix}"
        echo -e ''
        bash <(curl ${CURL_DEFAULT_OPTS} -s https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/AD/ADEN)
    elif [[ "$REGION_ID" == "8" ]]; then
        echo -e "${Font_Green}本次测试已结束，感谢使用此脚本${Font_Suffix}"
        echo -e ''
        echo -e "${Font_Yellow}检测脚本当天运行次数: ${TODAY_RUN_TIMES}; 共计运行次数: ${TOTAL_RUN_TIMES}${Font_Suffix}"
        echo -e ''
        bash <(curl ${CURL_DEFAULT_OPTS} -s https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/AD/ADKR)
        echo -e ''
    elif [[ "$REGION_ID" == "3" ]]; then
        echo -e "${Font_Green}本次测试已结束，感谢使用此脚本${Font_Suffix}"
        echo -e ''
        echo -e "${Font_Yellow}检测脚本当天运行次数: ${TODAY_RUN_TIMES}; 共计运行次数: ${TOTAL_RUN_TIMES}${Font_Suffix}"
        echo -e ''
        bash <(curl ${CURL_DEFAULT_OPTS} -s https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/AD/ADJP)
        echo -e ''
    else
        echo -e "${Font_Green}本次测试已结束，感谢使用此脚本${Font_Suffix}"
        echo -e ''
        echo -e "${Font_Yellow}检测脚本当天运行次数: ${TODAY_RUN_TIMES}; 共计运行次数: ${TOTAL_RUN_TIMES}${Font_Suffix}"
        echo -e ''
        bash <(curl ${CURL_DEFAULT_OPTS} -s https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/AD/AD1)
        echo -e ''
        bash <(curl ${CURL_DEFAULT_OPTS} -s https://raw.githubusercontent.com/lmc999/RegionRestrictionCheck/main/reference/AD/ADBW)
    fi
}

color_print

check_os_type

check_dependencies

process "$@"

clear

count_run_times

showSupportOS

showScriptTitle

if [ -z "$REGION_ID" ]; then
    inputOptions
fi

download_extra_data

clear

runScript

showGoodbye
