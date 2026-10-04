package com.github.kr328.clash.design.view

import android.content.Context
import android.util.AttributeSet
import android.widget.ScrollView
import androidx.annotation.AttrRes
import androidx.annotation.StyleRes

class ObservableScrollView @JvmOverloads constructor(
    context: Context,
    attributeSet: AttributeSet? = null,
    @AttrRes defStyleAttr: Int = 0,
    @StyleRes defStyleRes: Int = 0
) : ScrollView(context, attributeSet, defStyleAttr, defStyleRes) {
    fun interface OnScrollChangedListener {
        fun onChanged(scrollView: ObservableScrollView, x: Int, y: Int, oldl: Int, oldt: Int)
    }

    private val scrollChangedListeners: MutableSet<OnScrollChangedListener> = mutableSetOf()

    override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
        super.onScrollChanged(l, t, oldl, oldt)

        scrollChangedListeners.forEach {
            it.onChanged(this, l, t, oldl, oldt)
        }
    }

    fun addOnScrollChangedListener(listener: OnScrollChangedListener) {
        scrollChangedListeners.add(listener)
    }
}