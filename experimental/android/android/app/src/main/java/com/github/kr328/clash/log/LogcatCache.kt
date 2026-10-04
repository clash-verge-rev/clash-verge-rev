package com.github.kr328.clash.log

import androidx.collection.CircularArray
import com.github.kr328.clash.core.model.LogMessage
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class LogcatCache {
    data class Snapshot(val messages: List<LogMessage>, val removed: Int, val appended: Int)

    private val array = CircularArray<LogMessage>(CAPACITY)
    private val lock = Mutex()

    private var removed: Int = 0
    private var appended: Int = 0

    suspend fun append(msg: LogMessage) {
        lock.withLock {
            if (array.size() >= CAPACITY) {
                array.removeFromStart(1)

                removed++
                appended--
            }

            array.addLast(msg)

            appended++
        }
    }

    suspend fun snapshot(full: Boolean): Snapshot? {
        return lock.withLock {
            if (!full && removed == 0 && appended == 0) {
                return@withLock null
            }

            Snapshot(
                List(array.size()) { array[it] },
                removed,
                if (full) array.size() + appended else appended
            ).also {
                removed = 0
                appended = 0
            }
        }
    }

    companion object {
        const val CAPACITY = 128
    }
}
