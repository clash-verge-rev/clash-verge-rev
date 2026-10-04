package com.github.kr328.clash.design.view

import android.content.Context
import android.graphics.drawable.Drawable
import android.util.AttributeSet
import android.widget.FrameLayout
import androidx.annotation.AttrRes
import androidx.annotation.StyleRes
import com.github.kr328.clash.design.R
import com.github.kr328.clash.design.databinding.ComponentActionTextFieldBinding
import com.github.kr328.clash.design.util.layoutInflater

class ActionTextField @JvmOverloads constructor(
    context: Context,
    attributeSet: AttributeSet? = null,
    @AttrRes defStyleAttr: Int = 0,
    @StyleRes defStyleRes: Int = 0
) : FrameLayout(context, attributeSet, defStyleAttr, defStyleRes) {
    private val binding = ComponentActionTextFieldBinding
        .inflate(context.layoutInflater, this, true)

    var icon: Drawable?
        get() = binding.iconView.background
        set(value) {
            binding.iconView.background = value
        }

    var title: CharSequence?
        get() = binding.titleView.text
        set(value) {
            binding.titleView.text = value
        }

    var text: CharSequence?
        get() = binding.textView.text
        set(value) {
            if (isEnabled)
                binding.textView.text = value
            else
                binding.textView.text = context.getText(R.string.unavailable)
        }

    var placeholder: CharSequence?
        get() = binding.textView.hint
        set(value) {
            binding.textView.hint = value
        }

    override fun setEnabled(enabled: Boolean) {
        super.setEnabled(enabled)

        if (enabled) {
            binding.root.alpha = 1.0f
            binding.actionView.isFocusable = true
            binding.actionView.isClickable = true
        } else {
            binding.root.alpha = 0.33f
            binding.actionView.isFocusable = false
            binding.actionView.isClickable = false
        }

        text = text
    }

    override fun setOnClickListener(l: OnClickListener?) {
        binding.actionView.setOnClickListener(l)
    }

    init {
        context.theme.obtainStyledAttributes(
            attributeSet,
            R.styleable.ActionTextField,
            defStyleAttr,
            defStyleRes
        ).apply {
            try {
                isEnabled = getBoolean(R.styleable.ActionTextField_enabled, true)
                icon = getDrawable(R.styleable.ActionTextField_icon)
                title = getString(R.styleable.ActionTextField_title)
                text = getString(R.styleable.ActionTextField_text)
                placeholder = getString(R.styleable.ActionTextField_placeholder)
            } finally {
                recycle()
            }
        }
    }
}