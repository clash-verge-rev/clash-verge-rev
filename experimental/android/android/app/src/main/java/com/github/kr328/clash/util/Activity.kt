package com.github.kr328.clash.util

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

class ActivityResultLifecycle : LifecycleOwner {
    override val lifecycle = LifecycleRegistry(this)

    init {
        lifecycle.currentState = Lifecycle.State.INITIALIZED
    }

    suspend fun <T> use(block: suspend (lifecycle: ActivityResultLifecycle, start: () -> Unit) -> T): T {
        return try {
            markCreated()

            block(this, this::markStarted)
        } finally {
            withContext(NonCancellable) {
                markDestroy()
            }
        }
    }

    private fun markCreated() {
        lifecycle.currentState = Lifecycle.State.CREATED
    }

    private fun markStarted() {
        lifecycle.currentState = Lifecycle.State.STARTED
        lifecycle.currentState = Lifecycle.State.RESUMED
    }

    private fun markDestroy() {
        lifecycle.currentState = Lifecycle.State.DESTROYED
    }
}