@file:Suppress("DEPRECATION")

package com.github.kr328.clash.common.compat

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Handler
import androidx.annotation.ColorRes
import androidx.annotation.DrawableRes
import androidx.core.content.ContextCompat

fun Context.getColorCompat(@ColorRes id: Int): Int {
    return ContextCompat.getColor(this, id)
}

fun Context.getDrawableCompat(@DrawableRes id: Int): Drawable? {
    return ContextCompat.getDrawable(this, id)
}

@SuppressLint("UnspecifiedRegisterReceiverFlag")
fun Context.registerReceiverCompat(
    receiver: BroadcastReceiver,
    filter: IntentFilter,
    permission: String? = null,
    handler: Handler? = null
) =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
        registerReceiver(receiver, filter, permission, handler,
            if (permission == null) Context.RECEIVER_EXPORTED else Context.RECEIVER_NOT_EXPORTED
        )
    else
        registerReceiver(receiver, filter, permission, handler)
