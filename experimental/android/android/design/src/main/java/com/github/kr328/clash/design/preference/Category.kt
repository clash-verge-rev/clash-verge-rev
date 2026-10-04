package com.github.kr328.clash.design.preference

import android.view.View
import androidx.annotation.StringRes
import com.github.kr328.clash.design.databinding.PreferenceCategoryBinding
import com.github.kr328.clash.design.util.layoutInflater

fun PreferenceScreen.category(
    @StringRes text: Int,
) {
    val binding = PreferenceCategoryBinding
        .inflate(context.layoutInflater, root, false)

    binding.textView.text = context.getString(text)

    addElement(object : Preference {
        override val view: View
            get() = binding.root
        override var enabled: Boolean
            get() = binding.root.isEnabled
            set(value) {
                binding.root.isEnabled = value
            }
    })
}