package com.github.kr328.clash.common.store

import kotlin.reflect.KProperty

class Store(val provider: StoreProvider) {
    interface Delegate<T> {
        operator fun getValue(thisRef: Any?, property: KProperty<*>): T
        operator fun setValue(thisRef: Any?, property: KProperty<*>, value: T)
    }

    fun int(key: String, defaultValue: Int): Delegate<Int> {
        return object : Delegate<Int> {
            override fun getValue(thisRef: Any?, property: KProperty<*>): Int {
                return provider.getInt(key, defaultValue)
            }

            override fun setValue(thisRef: Any?, property: KProperty<*>, value: Int) {
                provider.setInt(key, value)
            }
        }
    }

    fun long(key: String, defaultValue: Long): Delegate<Long> {
        return object : Delegate<Long> {
            override fun getValue(thisRef: Any?, property: KProperty<*>): Long {
                return provider.getLong(key, defaultValue)
            }

            override fun setValue(thisRef: Any?, property: KProperty<*>, value: Long) {
                provider.setLong(key, value)
            }
        }
    }

    fun string(key: String, defaultValue: String): Delegate<String> {
        return object : Delegate<String> {
            override fun getValue(thisRef: Any?, property: KProperty<*>): String {
                return provider.getString(key, defaultValue)
            }

            override fun setValue(thisRef: Any?, property: KProperty<*>, value: String) {
                provider.setString(key, value)
            }
        }
    }

    fun stringSet(key: String, defaultValue: Set<String>): Delegate<Set<String>> {
        return object : Delegate<Set<String>> {
            override fun getValue(thisRef: Any?, property: KProperty<*>): Set<String> {
                return provider.getStringSet(key, defaultValue)
            }

            override fun setValue(thisRef: Any?, property: KProperty<*>, value: Set<String>) {
                provider.setStringSet(key, value)
            }
        }
    }

    fun boolean(key: String, defaultValue: Boolean): Delegate<Boolean> {
        return object : Delegate<Boolean> {
            override fun getValue(thisRef: Any?, property: KProperty<*>): Boolean {
                return provider.getBoolean(key, defaultValue)
            }

            override fun setValue(thisRef: Any?, property: KProperty<*>, value: Boolean) {
                provider.setBoolean(key, value)
            }
        }
    }

    fun <T : Enum<T>> enum(key: String, defaultValue: T, values: Array<T>): Delegate<T> {
        return object : Delegate<T> {
            override fun getValue(thisRef: Any?, property: KProperty<*>): T {
                val name = provider.getString(key, defaultValue.name)

                return values.find { name == it.name } ?: defaultValue
            }

            override fun setValue(thisRef: Any?, property: KProperty<*>, value: T) {
                provider.setString(key, value.name)
            }
        }
    }

    fun <T> typedString(key: String, from: (String) -> T?, to: (T?) -> String): Delegate<T?> {
        return object : Delegate<T?> {
            override fun getValue(thisRef: Any?, property: KProperty<*>): T? {
                val value = provider.getString(key, to(null))

                return from(value)
            }

            override fun setValue(thisRef: Any?, property: KProperty<*>, value: T?) {
                provider.setString(key, to(value))
            }
        }
    }
}