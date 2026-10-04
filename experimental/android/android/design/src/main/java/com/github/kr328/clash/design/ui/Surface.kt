package com.github.kr328.clash.design.ui

import androidx.databinding.BaseObservable
import androidx.databinding.Bindable
import com.github.kr328.clash.design.BR

class Surface : BaseObservable() {
    var insets: Insets = Insets.EMPTY
        @Bindable get
        set(value) {
            field = value

            notifyPropertyChanged(BR.insets)
        }
}