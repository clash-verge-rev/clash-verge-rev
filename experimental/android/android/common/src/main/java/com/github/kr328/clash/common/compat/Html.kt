@file:Suppress("DEPRECATION")

package com.github.kr328.clash.common.compat

import android.os.Build
import android.text.Html
import android.text.Spanned

fun fromHtmlCompat(content: String): Spanned {
    return if (Build.VERSION.SDK_INT >= 24) {
        Html.fromHtml(content, Html.FROM_HTML_MODE_COMPACT)
    } else {
        Html.fromHtml(content)
    }
}