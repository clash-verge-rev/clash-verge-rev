package com.github.kr328.clash.service.util

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

fun InetAddress.asSocketAddressText(port: Int): String {
    return when (this) {
        is Inet6Address ->
            "[${numericToTextFormat(this)}]:$port"
        is Inet4Address ->
            "${this.hostAddress}:$port"
        else -> throw IllegalArgumentException("Unsupported Inet type ${this.javaClass}")
    }
}

private const val INT16SZ = 2
private const val INADDRSZ = 16
private fun numericToTextFormat(address: Inet6Address): String {
    var src = address.getAddress()
    val sb = StringBuilder(39)
    for (i in 0 until INADDRSZ / INT16SZ) {
        sb.append(
            Integer.toHexString(
                src[i shl 1].toInt() shl 8 and 0xff00
                        or (src[(i shl 1) + 1].toInt() and 0xff)
            )
        )
        if (i < INADDRSZ / INT16SZ - 1) {
            sb.append(":")
        }
    }
    // handle [fe80::1%wlan0] like address from Inet6Address.getHostAddress()
    // For the Android system, a ScopeId must be carried when initiating a connection to an ipv6 link-local address
    // Note that the Scope must be returned as an int type, not a string format
    // Reference: https://github.com/golang/go/issues/68082
    if (address.getScopeId() > 0) {
        sb.append("%")
        sb.append(address.getScopeId())
    }
    return sb.toString()
}
