package com.github.kr328.clash.service.util

data class IPNet(val ip: String, val prefix: Int)

fun parseCIDR(cidr: String): IPNet {
    val s = cidr.split("/", limit = 2)

    if (s.size != 2)
        throw IllegalArgumentException("Invalid address")

    val address = s[0]
    val prefix = s[1].toInt()

    return IPNet(address, prefix)
}