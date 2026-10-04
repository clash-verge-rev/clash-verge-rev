package com.github.kr328.clash.design.model

import java.util.*

data class LogFile(val fileName: String, val date: Date) {
    companion object {
        private val REGEX_FILE = Regex("clash-(\\d+).log")
        private const val FORMAT_FILE_NAME = "clash-%d.log"

        fun parseFromFileName(fileName: String): LogFile? {
            return REGEX_FILE.matchEntire(fileName)?.run {
                LogFile(fileName, Date(groupValues[1].toLong()))
            }
        }

        fun generate(): LogFile {
            val current = Date()
            val fileName = FORMAT_FILE_NAME.format(current.time)

            return LogFile(fileName, current)
        }
    }
}