package com.github.kr328.clash.design.util

import androidx.recyclerview.widget.DiffUtil

fun <T> List<T>.diffWith(
    newList: List<T>,
    detectMove: Boolean = false,
    id: (T) -> Any? = { it }
): DiffUtil.DiffResult {
    val oldList = this

    return DiffUtil.calculateDiff(object : DiffUtil.Callback() {
        override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
            return id(oldList[oldItemPosition]) == id(newList[newItemPosition])
        }

        override fun getOldListSize(): Int {
            return oldList.size
        }

        override fun getNewListSize(): Int {
            return newList.size
        }

        override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
            return oldList[oldItemPosition] == newList[newItemPosition]
        }
    }, detectMove)
}
