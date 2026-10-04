package com.github.kr328.clash.design.preference

import android.content.Context
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import com.github.kr328.clash.design.R
import com.github.kr328.clash.design.adapter.EditableTextListAdapter
import com.github.kr328.clash.design.dialog.requestModelTextInput
import kotlinx.coroutines.*
import kotlin.reflect.KMutableProperty0

interface EditableTextListPreference<T> : ClickablePreference {
    var placeholder: CharSequence?

    var list: List<T>?
}

fun <T> PreferenceScreen.editableTextList(
    value: KMutableProperty0<List<T>?>,
    adapter: TextAdapter<T>,
    @StringRes title: Int,
    @DrawableRes icon: Int? = null,
    @StringRes placeholder: Int? = null,
    configure: EditableTextListPreference<T>.() -> Unit = {},
): EditableTextListPreference<T> {
    val impl =
        object : EditableTextListPreference<T>, ClickablePreference by clickable(title, icon) {
            override var list: List<T>? = null
                set(value) {
                    field = value

                    when {
                        value == null -> {
                            this.summary = this.placeholder
                        }
                        value.isEmpty() -> {
                            this.summary = context.getString(R.string.empty)
                        }
                        else -> {
                            this.summary = context.getString(R.string.format_elements, value.size)
                        }
                    }
                }
            override var placeholder: CharSequence? = null
        }

    if (placeholder != null) {
        impl.placeholder = context.getText(placeholder)
    }

    impl.configure()

    launch(Dispatchers.Main) {
        val v = withContext(Dispatchers.IO) {
            value.get()
        }

        impl.list = v

        impl.clicked {
            this@editableTextList.launch(Dispatchers.Main) {
                val newList = requestEditTextList(
                    impl.list,
                    context,
                    adapter,
                    impl.title
                )

                withContext(Dispatchers.IO) {
                    value.set(newList)
                }

                impl.list = newList
            }
        }
    }

    return impl
}

private suspend fun <T> requestEditTextList(
    initialValue: List<T>?,
    context: Context,
    adapter: TextAdapter<T>,
    title: CharSequence,
): List<T>? {
    val recyclerAdapter = EditableTextListAdapter(
        context,
        initialValue?.toMutableList() ?: mutableListOf(),
        adapter
    )

    val result = requestEditableListOverlay(context, recyclerAdapter, title) {
        val text = context.requestModelTextInput(
            initial = "",
            title = title,
            hint = title
        )

        if (text.isNotBlank()) {
            recyclerAdapter.addElement(text)
        }
    }

    return when (result) {
        EditableListOverlayResult.Cancel -> initialValue
        EditableListOverlayResult.Apply -> recyclerAdapter.values
        EditableListOverlayResult.Reset -> null
    }
}