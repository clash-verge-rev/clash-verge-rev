package com.github.kr328.clash.core.bridge

import androidx.annotation.Keep

/** Checks the native result lost by the upstream legacy void JNI entry point. */
@Keep
object CheckedTun {
    init {
        // Initialize the original JNI VM/callback table before the Go call.
        Bridge.nativeCoreVersion()
        System.loadLibrary("vergegate")
    }
    fun ensureLoaded() = Unit
    external fun start(fd: Int, stack: String, gateway: String, portal: String,
        dns: String, callback: TunInterface): Int
}
