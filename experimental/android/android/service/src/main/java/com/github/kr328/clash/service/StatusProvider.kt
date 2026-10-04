package com.github.kr328.clash.service

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import com.github.kr328.clash.common.Global

class StatusProvider : ContentProvider() {
    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        return when (method) {
            METHOD_CURRENT_PROFILE -> {
                return Bundle().apply {
                        putBoolean("serviceRunning", serviceRunning)
                        putBoolean("vpnServiceRunning", vpnServiceRunning)
                        putBoolean("tunReady", tunReady)
                        putString("name", currentProfile)
                        putString("uuid", currentProfileUUID)
                        putLong("generation", loadGeneration)
                    }
            }
            else -> super.call(method, arg, extras)
        }
    }

    override fun insert(uri: Uri, values: ContentValues?): Uri? {
        throw IllegalArgumentException("Stub!")
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?
    ): Cursor? {
        throw IllegalArgumentException("Stub!")
    }

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?
    ): Int {
        throw IllegalArgumentException("Stub!")
    }

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int {
        throw IllegalArgumentException("Stub!")
    }

    override fun getType(uri: Uri): String? {
        throw IllegalArgumentException("Stub!")
    }

    override fun onCreate(): Boolean {
        return true
    }

    companion object {
        const val METHOD_CURRENT_PROFILE = "currentProfile"

        private const val CLASH_SERVICE_RUNNING_FILE = "service_running.lock"

        @Volatile var serviceRunning: Boolean = false
            set(value) {
                field = value
                if (!value) {
                    currentProfile = null
                    currentProfileUUID = null
                    tunReady = false
                    vpnServiceRunning = false
                }

                shouldStartClashOnBoot = value
            }
        var shouldStartClashOnBoot: Boolean
            get() = Global.application.filesDir.resolve(CLASH_SERVICE_RUNNING_FILE).exists()
            set(value) {
                Global.application.filesDir.resolve(CLASH_SERVICE_RUNNING_FILE).apply {
                    if (value)
                        createNewFile()
                    else
                        delete()
                }
            }
        @Volatile var currentProfile: String? = null
        @Volatile var currentProfileUUID: String? = null
        @Volatile var loadGeneration: Long = 0
        @Volatile var vpnServiceRunning: Boolean = false
        @Volatile var tunReady: Boolean = false
    }
}
