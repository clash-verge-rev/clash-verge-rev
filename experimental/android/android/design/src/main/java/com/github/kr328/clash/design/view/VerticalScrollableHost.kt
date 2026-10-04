package com.github.kr328.clash.design.view

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import android.widget.FrameLayout
import kotlin.math.absoluteValue
import kotlin.math.tan

class VerticalScrollableHost @JvmOverloads constructor(
    context: Context,
    attributeSet: AttributeSet? = null,
    defStyleAttr: Int = 0,
    defStyleRes: Int = 0
) : FrameLayout(context, attributeSet, defStyleAttr, defStyleRes) {
    private var initialX = 0f
    private var initialY = 0f

    private val degree = tan(Math.toRadians(15.0))

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        val parentView = parent ?: return super.onInterceptTouchEvent(ev)

        if (ev.action == MotionEvent.ACTION_DOWN) {
            initialX = ev.x
            initialY = ev.y
            parentView.requestDisallowInterceptTouchEvent(true)
        } else if (ev.action == MotionEvent.ACTION_MOVE) {
            val dx = ev.x - initialX
            val dy = ev.y - initialY

            val t = dy.absoluteValue / dx.absoluteValue

            if (t < degree) {
                parentView.requestDisallowInterceptTouchEvent(false)
            }
        }

        return super.onInterceptTouchEvent(ev)
    }
}