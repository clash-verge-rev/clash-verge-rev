package com.github.kr328.clash.core.bridge

import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.annotation.Keep
import com.github.kr328.clash.common.Global
import com.github.kr328.clash.common.log.Log
import kotlinx.coroutines.CompletableDeferred
import java.io.File

@Keep
object Bridge {
    external fun nativeReset()
    external fun nativeForceGc()
    external fun nativeSuspend(suspend: Boolean)
    external fun nativeQueryTunnelState(): String
    external fun nativeQueryTrafficNow(): Long
    external fun nativeQueryTrafficTotal(): Long
    external fun nativeNotifyDnsChanged(dnsList: String)
    external fun nativeNotifyTimeZoneChanged(name: String, offset: Int)
    external fun nativeNotifyInstalledAppChanged(uidList: String)
    external fun nativeStartTun(fd: Int, stack: String, gateway: String, portal: String, dns: String, cb: TunInterface)
    external fun nativeStopTun()
    external fun nativeStartHttp(listenAt: String): String?
    external fun nativeStopHttp()
    external fun nativeQueryGroupNames(excludeNotSelectable: Boolean): String
    external fun nativeQueryGroup(name: String, sort: String): String?
    external fun nativeHealthCheck(completable: CompletableDeferred<Unit>, name: String)
    external fun nativeHealthCheckAll()
    external fun nativePatchSelector(selector: String, name: String): Boolean
    external fun nativeFetchAndValid(
        completable: FetchCallback,
        path: String,
        url: String,
        force: Boolean
    )

    external fun nativeLoad(completable: CompletableDeferred<Unit>, path: String)
    external fun nativeQueryProviders(): String
    external fun nativeUpdateProvider(
        completable: CompletableDeferred<Unit>,
        type: String,
        name: String
    )

    external fun nativeReadOverride(slot: Int): String
    external fun nativeWriteOverride(slot: Int, content: String)
    external fun nativeClearOverride(slot: Int)
    external fun nativeQueryConfiguration(): String
    external fun nativeSubscribeLogcat(callback: LogcatInterface)
    external fun nativeCoreVersion(): String

    external fun nativeSetAgeSecretKey(key: String?)
    external fun nativeGenX25519KeyPair(): String?
    external fun nativeGenHybridKeyPair(): String?
    external fun nativeVeritySecretKeys(secretKeys: String): Boolean
    external fun nativeToPublicKeys(secretKeys: String): String?
    external fun nativeVerityPublicKeys(publicKeys: String): Boolean

    private external fun nativeInit(home: String, versionName: String, sdkVersion: Int)

    init {
        System.loadLibrary("bridge")

        val ctx = Global.application

        ParcelFileDescriptor.open(File(ctx.packageCodePath), ParcelFileDescriptor.MODE_READ_ONLY)
            .detachFd()

        val home = ctx.filesDir.resolve("clash").apply { mkdirs() }.absolutePath
        val versionName = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "unknown"
        val sdkVersion = Build.VERSION.SDK_INT

        Log.d("Home = $home")

        nativeInit(home, versionName, sdkVersion)
    }
}