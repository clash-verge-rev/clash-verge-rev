package com.github.kr328.clash.core.util

import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URL

fun parseInetSocketAddress(address: String): InetSocketAddress {
    val url = URL("https://$address")

    return InetSocketAddress(InetAddress.getByName(url.host), url.port)
}