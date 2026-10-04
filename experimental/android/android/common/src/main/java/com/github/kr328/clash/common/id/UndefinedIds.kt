package com.github.kr328.clash.common.id

object UndefinedIds {
    private const val PREFIX = 0x14000000
    private const val MASK = 0x00FFFFFF

    private var current: Int = 0

    @Synchronized
    fun next(): Int {
        current = ((current and MASK) + 1 or PREFIX)

        return current
    }
}
