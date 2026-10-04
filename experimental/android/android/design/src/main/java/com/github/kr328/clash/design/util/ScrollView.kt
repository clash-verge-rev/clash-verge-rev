package com.github.kr328.clash.design.util

import com.github.kr328.clash.design.view.ObservableScrollView

val ObservableScrollView.isTop: Boolean
    get() = scrollX == 0 && scrollY == 0
