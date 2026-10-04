package com.github.kr328.clash.util

import android.content.ContentResolver
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.FileNotFoundException

private fun fileNotFound(file: Uri): FileNotFoundException {
    return FileNotFoundException("$file not found")
}

@Suppress("BlockingMethodInNonBlockingContext")
suspend fun ContentResolver.copyContentTo(
    source: Uri,
    target: Uri
) {
    withContext(Dispatchers.IO) {
        (openInputStream(source) ?: throw fileNotFound(source)).use { input ->
            (openOutputStream(target, "rwt") ?: throw fileNotFound(target)).use { output ->
                input.copyTo(output)
            }
        }
    }
}