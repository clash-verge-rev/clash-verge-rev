@file:Suppress("DEPRECATION")

package com.github.kr328.clash.common.compat

import android.annotation.TargetApi
import android.os.Build
import android.view.View
import android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
import android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
import android.view.Window
import android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
import android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
import android.view.WindowManager

var Window.isSystemBarsTranslucentCompat: Boolean
    get() {
        throw UnsupportedOperationException("set value only")
    }
    set(value) {
        if (Build.VERSION.SDK_INT >= 30) {
            setDecorFitsSystemWindows(!value)
        } else {
            decorView.systemUiVisibility =
                if (value) {
                    decorView.systemUiVisibility or
                            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                } else {
                    decorView.systemUiVisibility and
                            (View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION).inv()
                }
        }

        if (Build.VERSION.SDK_INT >= 28) {
            if (value) {
                attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            } else {
                attributes.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
            }
        }
    }

var Window.isLightStatusBarsCompat: Boolean
    get() {
        throw UnsupportedOperationException("set value only")
    }
    @TargetApi(23)
    set(value) {
        if (value) {
            if (Build.VERSION.SDK_INT >= 30) {
                decorView.windowInsetsController?.apply {
                    setSystemBarsAppearance(
                        APPEARANCE_LIGHT_STATUS_BARS,
                        APPEARANCE_LIGHT_STATUS_BARS
                    )
                }
            } else {
                decorView.systemUiVisibility =
                    decorView.systemUiVisibility or SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            }
        } else {
            if (Build.VERSION.SDK_INT >= 30) {
                decorView.windowInsetsController?.apply {
                    setSystemBarsAppearance(
                        0,
                        APPEARANCE_LIGHT_STATUS_BARS
                    )
                }
            } else {
                decorView.systemUiVisibility =
                    decorView.systemUiVisibility and SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
            }
        }
    }

var Window.isLightNavigationBarCompat: Boolean
    get() {
        throw UnsupportedOperationException("set value only")
    }
    @TargetApi(27)
    set(value) {
        if (value) {
            if (Build.VERSION.SDK_INT >= 30) {
                decorView.windowInsetsController?.apply {
                    setSystemBarsAppearance(
                        APPEARANCE_LIGHT_NAVIGATION_BARS,
                        APPEARANCE_LIGHT_NAVIGATION_BARS
                    )
                }
            } else {
                decorView.systemUiVisibility =
                    decorView.systemUiVisibility or SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            }
        } else {
            if (Build.VERSION.SDK_INT >= 30) {
                decorView.windowInsetsController?.apply {
                    setSystemBarsAppearance(
                        0,
                        APPEARANCE_LIGHT_NAVIGATION_BARS
                    )
                }
            } else {
                decorView.systemUiVisibility =
                    decorView.systemUiVisibility and SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
            }
        }
    }

var Window.isAllowForceDarkCompat: Boolean
    get() {
        return if (Build.VERSION.SDK_INT >= 29) {
            decorView.isForceDarkAllowed
        } else {
            false
        }
    }
    set(value) {
        if (Build.VERSION.SDK_INT >= 29) {
            decorView.isForceDarkAllowed = value
        }
    }