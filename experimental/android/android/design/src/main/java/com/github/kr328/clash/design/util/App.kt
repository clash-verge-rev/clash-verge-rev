package com.github.kr328.clash.design.util

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import com.github.kr328.clash.common.compat.foreground
import com.github.kr328.clash.design.model.AppInfo

fun PackageInfo.toAppInfo(pm: PackageManager): AppInfo {
    return AppInfo(
        packageName = packageName,
        icon = applicationInfo!!.loadIcon(pm).foreground(),
        label = applicationInfo!!.loadLabel(pm).toString(),
        installTime = firstInstallTime,
        updateDate = lastUpdateTime,
    )
}
