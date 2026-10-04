package com.github.kr328.clash.design.view

import android.content.Context
import android.graphics.Canvas
import android.util.AttributeSet
import androidx.annotation.AttrRes
import androidx.recyclerview.widget.RecyclerView

class AppRecyclerView @JvmOverloads constructor(
    context: Context,
    attributeSet: AttributeSet? = null,
    @AttrRes defStyleAttr: Int = 0
) : RecyclerView(context, attributeSet, defStyleAttr) {
    init {
        isFocusable = false
    }
}
