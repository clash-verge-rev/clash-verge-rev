package com.github.kr328.clash.common.store

interface StoreProvider {
    fun getInt(key: String, defaultValue: Int): Int
    fun setInt(key: String, value: Int)

    fun getLong(key: String, defaultValue: Long): Long
    fun setLong(key: String, value: Long)

    fun getString(key: String, defaultValue: String): String
    fun setString(key: String, value: String)

    fun getStringSet(key: String, defaultValue: Set<String>): Set<String>
    fun setStringSet(key: String, value: Set<String>)

    fun getBoolean(key: String, defaultValue: Boolean): Boolean
    fun setBoolean(key: String, value: Boolean)
}