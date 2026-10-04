package com.github.kr328.clash.service.document

import java.util.*

data class Path(
    val uuid: UUID?,
    val scope: Scope?,
    val relative: List<String>?
) {
    enum class Scope {
        Configuration, Providers
    }

    override fun toString(): String {
        if (uuid == null)
            return "/"

        if (scope == null)
            return "/$uuid"

        val sc = when (scope) {
            Scope.Configuration -> Paths.CONFIGURATION_ID
            Scope.Providers -> Paths.PROVIDERS_ID
        }

        if (relative == null)
            return "/$uuid/$sc"

        return "/$uuid/$sc/${relative.joinToString(separator = "/")}"
    }
}