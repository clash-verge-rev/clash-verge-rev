package com.github.kr328.clash.service.clash.module

import android.net.ConnectivityManager
import android.net.VpnService
import android.os.Build
import androidx.core.content.getSystemService
import com.github.kr328.clash.core.Clash
import com.github.kr328.clash.service.StatusProvider
import com.github.kr328.clash.core.util.parseInetSocketAddress
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withContext
import java.net.InetSocketAddress
import java.security.SecureRandom

class TunModule(private val vpn: VpnService) : Module<Unit>(vpn) {
    data class TunDevice(
        val fd: Int,
        var stack: String,
        val gateway: String,
        val portal: String,
        val dns: String,
    )

    private val connectivity = service.getSystemService<ConnectivityManager>()!!
    private val close = Channel<Unit>(Channel.CONFLATED)

    private fun queryUid(
        protocol: Int,
        source: InetSocketAddress,
        target: InetSocketAddress,
    ): Int {
        if (Build.VERSION.SDK_INT < 29)
            return -1

        return runCatching { connectivity.getConnectionOwnerUid(protocol, source, target) }
            .getOrElse { -1 }
    }

    override suspend fun run() {
        try {
            return close.receive()
        } finally {
            withContext(NonCancellable) {
                requestStop()
            }
        }
    }

    fun listenHttp(): InetSocketAddress? {
        val r = { 1 + random.nextInt(199) }
        val listenAt = "127.${r()}.${r()}.${r()}:0"
        val address = Clash.startHttp(listenAt)

        return address?.let(::parseInetSocketAddress)
    }

    fun attach(device: TunDevice) {
        StatusProvider.tunReady = false
        Clash.startTun(
            fd = device.fd,
            stack = device.stack,
            gateway = device.gateway,
            portal = device.portal,
            dns = device.dns,
            markSocket = vpn::protect,
            querySocketUid = this::queryUid
        )
        // CheckedTun preserves Go tun.Start's error code; readiness cannot precede it.
        StatusProvider.tunReady = true
    }

    suspend fun close() {
        close.send(Unit)
    }

    companion object {
        private val random = SecureRandom()

        fun requestStop() {
            StatusProvider.tunReady = false
            Clash.stopHttp()
            Clash.stopTun()
        }
    }
}
