package com.github.kr328.clash

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi
import com.github.kr328.clash.common.compat.registerReceiverCompat
import com.github.kr328.clash.common.constants.Intents
import com.github.kr328.clash.common.constants.Permissions
import com.github.kr328.clash.remote.StatusClient
import com.github.kr328.clash.util.startClashService
import com.github.kr328.clash.util.stopClashService
import com.github.kr328.clash.service.R

@RequiresApi(Build.VERSION_CODES.N)
class TileService : TileService() {
    private var currentProfile = ""
    private var clashRunning = false

    override fun onClick() {
        val tile = qsTile ?: return

        when (tile.state) {
            Tile.STATE_INACTIVE -> {
                startClashService()
            }
            Tile.STATE_ACTIVE -> {
                stopClashService()
            }
        }
    }

    override fun onStartListening() {
        super.onStartListening()

        registerReceiverCompat(
            receiver,
            IntentFilter().apply {
                addAction(Intents.ACTION_CLASH_STARTED)
                addAction(Intents.ACTION_CLASH_STOPPED)
                addAction(Intents.ACTION_PROFILE_LOADED)
                addAction(Intents.ACTION_SERVICE_RECREATED)
            },
            Permissions.RECEIVE_SELF_BROADCASTS,
            null
        )

        val name = StatusClient(this).currentProfile()

        clashRunning = name != null
        currentProfile = name ?: ""

        updateTile()
    }

    override fun onStopListening() {
        super.onStopListening()

        unregisterReceiver(receiver)
    }

    private fun updateTile() {
        val tile = qsTile ?: return

        tile.state = if (clashRunning)
            Tile.STATE_ACTIVE
        else
            Tile.STATE_INACTIVE

        tile.label = if (currentProfile.isEmpty())
            getText(R.string.launch_name)
        else
            currentProfile

        tile.icon = Icon.createWithResource(this, R.drawable.ic_logo_service)

        tile.updateTile()
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                Intents.ACTION_CLASH_STARTED -> {
                    clashRunning = true

                    currentProfile = ""
                }
                Intents.ACTION_CLASH_STOPPED, Intents.ACTION_SERVICE_RECREATED -> {
                    clashRunning = false

                    currentProfile = ""
                }
                Intents.ACTION_PROFILE_LOADED -> {
                    currentProfile = StatusClient(this@TileService).currentProfile() ?: ""
                }
            }

            updateTile()
        }
    }
}