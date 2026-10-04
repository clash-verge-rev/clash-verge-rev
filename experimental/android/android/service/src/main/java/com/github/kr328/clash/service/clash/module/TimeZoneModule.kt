package com.github.kr328.clash.service.clash.module

import android.app.Service
import android.content.Intent
import com.github.kr328.clash.core.Clash
import java.util.*

class TimeZoneModule(service: Service) : Module<Unit>(service) {
    override suspend fun run() {
        val timeZones = receiveBroadcast {
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
        }

        while (true) {
            val timeZone = TimeZone.getDefault()

            Clash.notifyTimeZoneChanged(timeZone.id, timeZone.rawOffset / 1000)

            timeZones.receive()
        }
    }
}