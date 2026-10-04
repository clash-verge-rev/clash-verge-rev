package com.github.kr328.clash.design.preference

interface NullableTextAdapter<T> {
    fun from(value: T): String?
    fun to(text: String?): T

    companion object {
        val Port = object : NullableTextAdapter<Int?> {
            override fun from(value: Int?): String? {
                if (value == null) return null

                return if (value > 0) value.toString() else ""
            }

            override fun to(text: String?): Int? {
                if (text == null) return null

                return text.toIntOrNull() ?: 0
            }
        }

        val String = object : NullableTextAdapter<String?> {
            override fun from(value: String?): String? {
                return value
            }

            override fun to(text: String?): String? {
                return text
            }
        }
    }
}

interface TextAdapter<T> {
    fun from(value: T): String
    fun to(text: String): T

    companion object {
        val String = object : TextAdapter<String> {
            override fun from(value: String): String {
                return value
            }

            override fun to(text: String): String {
                return text
            }
        }
    }
}