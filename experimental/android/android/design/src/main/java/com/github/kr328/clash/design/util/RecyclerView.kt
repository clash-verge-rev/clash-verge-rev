package com.github.kr328.clash.design.util

import android.content.Context
import android.view.View
import androidx.core.view.children
import androidx.databinding.Observable
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.github.kr328.clash.design.BR
import com.github.kr328.clash.design.ui.Surface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.reflect.KMutableProperty0

fun RecyclerView.applyLinearAdapter(context: Context, adapter: RecyclerView.Adapter<*>) {
    this.layoutManager = LinearLayoutManager(context)
    this.adapter = adapter
}

suspend fun <H : RecyclerView.ViewHolder, T> RecyclerView.Adapter<H>.swapDataSet(
    property: KMutableProperty0<List<T>>,
    newDataset: List<T>,
    compareEquals: Boolean = true
) {
    val ignore = withContext(Dispatchers.Default) {
        compareEquals && property.get() == newDataset
    }

    if (ignore) return

    withContext(Dispatchers.Main) {
        if (property.get().size == newDataset.size) {
            property.set(newDataset)

            notifyItemRangeChanged(0, newDataset.size)
        } else {
            notifyItemRangeRemoved(0, property.get().size)

            property.set(newDataset)

            notifyItemRangeInserted(0, newDataset.size)
        }
    }
}

suspend fun <H : RecyclerView.ViewHolder, T> RecyclerView.Adapter<H>.patchDataSet(
    property: KMutableProperty0<List<T>>,
    newDataset: List<T>,
    detectMove: Boolean = false,
    id: (T) -> Any? = { it }
) {
    val result = withContext(Dispatchers.Default) {
        property.get().diffWith(newDataset, detectMove, id)
    }

    withContext(Dispatchers.Main) {
        property.set(newDataset)
        result.dispatchUpdatesTo(this@patchDataSet)
    }
}

fun RecyclerView.invalidateChildren() {
    children.forEach {
        it.postInvalidate()
    }
}

fun RecyclerView.bindInsets(surface: Surface, top: Int = 0, bottom: Int = 0) {
    fun applyInsets() {
        val t = surface.insets.top + top
        val b = surface.insets.bottom + bottom

        setPaddingRelative(0, t, 0, b)
    }

    surface.addOnPropertyChangedCallback(object : Observable.OnPropertyChangedCallback() {
        override fun onPropertyChanged(sender: Observable?, propertyId: Int) {
            if (propertyId == BR.insets) {
                applyInsets()
            }
        }
    })

    applyInsets()
}

fun RecyclerView.addScrolledToBottomObserver(listener: (RecyclerView, Boolean) -> Unit) {
    val observer = object : RecyclerView.OnScrollListener() {
        override fun onScrollStateChanged(recyclerView: RecyclerView, newState: Int) {
            if (newState == RecyclerView.SCROLL_STATE_IDLE) {
                listener(this@addScrolledToBottomObserver, recyclerView.isBottom)
            }
        }
    }

    addOnScrollListener(observer)
}

val RecyclerView.firstVisibleView: View?
    get() {
        return when (val mgr = layoutManager) {
            is LinearLayoutManager ->
                mgr.findViewByPosition(mgr.findFirstVisibleItemPosition())
            else ->
                throw UnsupportedOperationException("unsupported manager: $mgr")
        }
    }

val RecyclerView.isTop: Boolean
    get() = computeHorizontalScrollOffset() == 0 && computeVerticalScrollOffset() == 0

val RecyclerView.isBottom: Boolean
    get() {
        return when (val mgr = layoutManager) {
            is GridLayoutManager -> {
                mgr.findFirstVisibleItemPosition() != 0 &&
                        mgr.findLastVisibleItemPosition() == adapter!!.itemCount - 1
            }
            else -> {
                throw UnsupportedOperationException("unsupported layout manager")
            }
        }
    }