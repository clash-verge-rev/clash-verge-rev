@file:Suppress("DEPRECATION")

package com.github.kr328.clash.common.compat

import android.content.pm.PackageInfo

val PackageInfo.versionCodeCompat: Long
    get() {
        return if (android.os.Build.VERSION.SDK_INT >= 28) {
            longVersionCode
        } else {
            versionCode.toLong()
        }
    }
