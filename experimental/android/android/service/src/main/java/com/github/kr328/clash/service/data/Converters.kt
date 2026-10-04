package com.github.kr328.clash.service.data

import androidx.room.TypeConverter
import com.github.kr328.clash.service.model.Profile
import java.util.*

class Converters {
    @TypeConverter
    fun fromUUID(uuid: UUID): String {
        return uuid.toString()
    }

    @TypeConverter
    fun toUUID(uuid: String): UUID {
        return UUID.fromString(uuid)
    }

    @TypeConverter
    fun fromProfileType(type: Profile.Type): String {
        return type.name
    }

    @TypeConverter
    fun toProfileType(type: String): Profile.Type {
        return Profile.Type.valueOf(type)
    }
}