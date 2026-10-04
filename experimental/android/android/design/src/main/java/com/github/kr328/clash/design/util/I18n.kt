package com.github.kr328.clash.design.util

import android.content.Context
import com.github.kr328.clash.common.compat.preferredLocale
import com.github.kr328.clash.core.model.Provider
import com.github.kr328.clash.design.R
import com.github.kr328.clash.service.model.Profile
import java.text.SimpleDateFormat
import java.util.*

private const val DATE_DATE_ONLY = "yyyy-MM-dd"
private const val DATE_TIME_ONLY = "HH:mm:ss.SSS"
private const val DATE_ALL = "$DATE_DATE_ONLY $DATE_TIME_ONLY"

fun Profile.Type.toString(context: Context): String {
    return when (this) {
        Profile.Type.File -> context.getString(R.string.file)
        Profile.Type.Url -> context.getString(R.string.url)
        Profile.Type.External -> context.getString(R.string.external)
    }
}

fun Provider.type(context: Context): String {
    val type = when (type) {
        Provider.Type.Proxy -> context.getString(R.string.proxy)
        Provider.Type.Rule -> context.getString(R.string.rule)
    }

    val vehicle = when (vehicleType) {
        Provider.VehicleType.HTTP -> context.getString(R.string.http)
        Provider.VehicleType.File -> context.getString(R.string.file)
        Provider.VehicleType.Inline -> context.getString(R.string.inline)
        Provider.VehicleType.Compatible -> context.getString(R.string.compatible)
    }

    return context.getString(R.string.format_provider_type, type, vehicle)
}

@JvmOverloads
fun Date.format(
    context: Context,
    includeDate: Boolean = true,
    includeTime: Boolean = true,
): String {
    val locale = context.resources.configuration.preferredLocale

    return when {
        includeDate && includeTime ->
            SimpleDateFormat(DATE_ALL, locale).format(this)
        includeDate ->
            SimpleDateFormat(DATE_DATE_ONLY, locale).format(this)
        includeTime ->
            SimpleDateFormat(DATE_TIME_ONLY, locale).format(this)
        else -> ""
    }
}

fun Long.toBytesString(): String {
    return when {
        this > 1024.0 * 1024 * 1024 * 1024 * 1024 * 1024 ->
            String.format("%.2f EiB", (this.toDouble() / 1024 / 1024 / 1024 / 1024 / 1024 / 1024))
        this > 1024.0 * 1024 * 1024 * 1024 * 1024 ->
            String.format("%.2f PiB", (this.toDouble() / 1024 / 1024 / 1024 / 1024 / 1024))
        this > 1024.0 * 1024 * 1024 * 1024 ->
            String.format("%.2f TiB", (this.toDouble() / 1024 / 1024 / 1024 / 1024))
        this > 1024 * 1024 * 1024 ->
            String.format("%.2f GiB", (this.toDouble() / 1024 / 1024 / 1024))
        this > 1024 * 1024 ->
            String.format("%.2f MiB", (this.toDouble() / 1024 / 1024))
        this > 1024 ->
            String.format("%.2f KiB", (this.toDouble() / 1024))
        else ->
            "$this Bytes"
    }
}

fun Double.toProgress(): Int {
    return this.toInt()
}
fun Long.toDateStr(): String {
    val simpleDateFormat =SimpleDateFormat("yyyy-MM-dd HH:mm:ss")
    return simpleDateFormat.format(Date(this))
}