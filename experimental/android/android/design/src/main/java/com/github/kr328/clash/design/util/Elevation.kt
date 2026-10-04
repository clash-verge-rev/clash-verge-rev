package com.github.kr328.clash.design.util

import android.animation.ValueAnimator
import androidx.recyclerview.widget.RecyclerView
import com.github.kr328.clash.design.R
import com.github.kr328.clash.design.view.ActivityBarLayout
import com.github.kr328.clash.design.view.ObservableScrollView

private class AppBarElevationController(
    private val activityBar: ActivityBarLayout
) {
    private var animator: ValueAnimator? = null

    var elevated: Boolean = false
        set(value) {
            if (field == value)
                return

            field = value

            animator?.end()

            animator = if (value) {
                ValueAnimator.ofFloat(
                    activityBar.elevation,
                    activityBar.context.getPixels(R.dimen.toolbar_elevation).toFloat()
                )
            } else {
                ValueAnimator.ofFloat(
                    activityBar.elevation,
                    0f
                )
            }.apply {
                addUpdateListener {
                    activityBar.elevation = it.animatedValue as Float
                }

                start()
            }
        }
}

fun RecyclerView.bindAppBarElevation(activityBar: ActivityBarLayout) {
    addOnScrollListener(object : RecyclerView.OnScrollListener() {
        private val controller = AppBarElevationController(activityBar)

        override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
            controller.elevated = !recyclerView.isTop
        }
    })
}

fun ObservableScrollView.bindAppBarElevation(activityBar: ActivityBarLayout) {
    val controller = AppBarElevationController(activityBar)

    addOnScrollChangedListener { view, _, _, _, _ ->
        controller.elevated = !view.isTop
    }
}