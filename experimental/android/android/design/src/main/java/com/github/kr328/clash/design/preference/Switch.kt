package com.github.kr328.clash.design.preference

import android.graphics.drawable.Drawable
import android.view.View
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import com.github.kr328.clash.common.compat.getDrawableCompat
import com.github.kr328.clash.design.databinding.PreferenceSwitchBinding
import com.github.kr328.clash.design.util.layoutInflater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.reflect.KMutableProperty0

interface SwitchPreference : Preference {
    var icon: Drawable?
    var title: CharSequence?
    var summary: CharSequence?
    var listener: OnChangedListener?
}

fun PreferenceScreen.switch(
    value: KMutableProperty0<Boolean>,
    @DrawableRes icon: Int? = null,
    @StringRes title: Int? = null,
    @StringRes summary: Int? = null,
    configure: SwitchPreference.() -> Unit = {},
): SwitchPreference {
    val binding = PreferenceSwitchBinding
        .inflate(context.layoutInflater, root, false)

    val impl = object : SwitchPreference {
        override val view: View
            get() = binding.root
        override var icon: Drawable?
            get() = binding.iconView.background
            set(value) {
                binding.iconView.background = value
            }
        override var title: CharSequence?
            get() = binding.titleView.text
            set(value) {
                binding.titleView.text = value
            }
        override var summary: CharSequence?
            get() = binding.summaryView.text
            set(value) {
                binding.summaryView.text = value
            }
        override var listener: OnChangedListener? = null
        override var enabled: Boolean
            get() = binding.root.isEnabled
            set(value) {
                binding.root.isEnabled = value
                binding.root.isFocusable = value
                binding.root.isClickable = value
                binding.root.alpha = if (value) 1.0f else 0.33f
            }

    }

    if (icon != null) {
        impl.icon = context.getDrawableCompat(icon)
    }

    if (title != null) {
        impl.title = context.getString(title)
    }

    if (summary != null) {
        impl.summary = context.getString(summary)
    }

    impl.configure()

    addElement(impl)

    launch(Dispatchers.Main) {
        val initialValue = withContext(Dispatchers.IO) {
            value.get()
        }

        binding.switchView.apply {
            isChecked = initialValue

            binding.root.setOnClickListener {
                isChecked = !isChecked

                this@switch.launch(Dispatchers.Main) {
                    withContext(Dispatchers.IO) {
                        value.set(isChecked)
                    }

                    impl.listener?.onChanged()
                }
            }
        }
    }

    return impl
}