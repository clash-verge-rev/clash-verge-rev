package com.github.kr328.clash.design.util

import android.view.View
import android.view.inputmethod.InputMethodManager
import androidx.core.content.getSystemService

fun View.requestTextInput() {
    post {
        requestFocus()

        postDelayed({
            context.getSystemService<InputMethodManager>()
                ?.showSoftInput(this, 0)
        }, 300)
    }
}
