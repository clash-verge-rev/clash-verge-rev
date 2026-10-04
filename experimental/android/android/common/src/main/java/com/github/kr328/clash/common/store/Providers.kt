package com.github.kr328.clash.common.store

import android.content.SharedPreferences
import androidx.core.content.edit

class SharedPreferenceProvider(private val preferences: SharedPreferences) : StoreProvider {
    override fun getInt(key: String, defaultValue: Int): Int {
        return preferences.getInt(key, defaultValue)
    }

    override fun setInt(key: String, value: Int) {
        preferences.edit {
            putInt(key, value)
        }
    }

    override fun getLong(key: String, defaultValue: Long): Long {
        return preferences.getLong(key, defaultValue)
    }

    override fun setLong(key: String, value: Long) {
        preferences.edit {
            putLong(key, value)
        }
    }

    override fun getString(key: String, defaultValue: String): String {
        return preferences.getString(key, defaultValue)!!
    }

    override fun setString(key: String, value: String) {
        preferences.edit {
            putString(key, value)
        }
    }

    override fun getStringSet(key: String, defaultValue: Set<String>): Set<String> {
        return preferences.getStringSet(key, defaultValue)!!
    }

    override fun setStringSet(key: String, value: Set<String>) {
        preferences.edit {
            putStringSet(key, value)
        }
    }

    override fun getBoolean(key: String, defaultValue: Boolean): Boolean {
        return preferences.getBoolean(key, defaultValue)
    }

    override fun setBoolean(key: String, value: Boolean) {
        preferences.edit {
            putBoolean(key, value)
        }
    }
}

fun SharedPreferences.asStoreProvider(): StoreProvider {
    return SharedPreferenceProvider(this)
}