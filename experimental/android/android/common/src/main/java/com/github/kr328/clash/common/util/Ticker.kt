package com.github.kr328.clash.common.util

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

fun CoroutineScope.ticker(period: Long): Channel<Long> {
    val channel = Channel<Long>(Channel.RENDEZVOUS)

    launch {
        try {
            while (isActive) {
                channel.send(System.currentTimeMillis())

                delay(period)
            }
        } catch (ignored: Exception) {

        }
    }

    return channel
}