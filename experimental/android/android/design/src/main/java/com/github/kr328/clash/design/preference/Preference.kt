package com.github.kr328.clash.design.preference

import android.view.View

fun interface OnChangedListener {
    fun onChanged()
}

interface Preference {
    val view: View

    var enabled: Boolean
        get() = view.isEnabled
        set(value) {
            view.isEnabled = value
            view.isClickable = value
            view.isFocusable = value
            view.alpha = if (value) 1.0f else 0.33f
        }
}