package com.github.kr328.clash.common.util

import android.content.Intent
import android.net.Uri
import java.util.*

fun Intent.grantPermissions(read: Boolean = true, write: Boolean = true): Intent {
    var flags = 0

    if (read)
        flags = flags or Intent.FLAG_GRANT_READ_URI_PERMISSION

    if (write)
        flags = flags or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    addFlags(flags)

    return this
}

var Intent.fileName: String?
    get() {
        return data?.takeIf { it.scheme == "file" }?.schemeSpecificPart
    }
    set(value) {
        data = Uri.fromParts("file", value, null)
    }

var Intent.uuid: UUID?
    get() {
        return data?.takeIf { it.scheme == "uuid" }?.schemeSpecificPart?.let(UUID::fromString)
    }
    set(value) {
        data = Uri.fromParts("uuid", value.toString(), null)
    }

fun Intent.setUUID(uuid: UUID): Intent {
    this.uuid = uuid

    return this
}

fun Intent.setFileName(fileName: String): Intent {
    this.fileName = fileName

    return this
}