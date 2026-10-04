package com.github.kr328.clash.design.util

import android.content.Context
import com.github.kr328.clash.design.R
import java.util.concurrent.TimeUnit

fun Long.elapsedIntervalString(context: Context): String {
    val day = TimeUnit.MILLISECONDS.toDays(this)
    val hour = TimeUnit.MILLISECONDS.toHours(this)
    val minute = TimeUnit.MILLISECONDS.toMinutes(this)

    return when {
        day > 0 -> context.getString(R.string.format_days_ago, day)
        hour > 0 -> context.getString(R.string.format_hours_ago, hour)
        minute > 0 -> context.getString(R.string.format_minutes_ago, minute)
        else -> context.getString(R.string.recently)
    }
}