@file:UseSerializers(DateSerializer::class)

package com.github.kr328.clash.core.model

import android.os.Parcel
import android.os.Parcelable
import com.github.kr328.clash.core.util.DateSerializer
import com.github.kr328.clash.core.util.Parcelizer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.UseSerializers
import java.util.*

@Serializable
data class LogMessage(
    val level: Level,
    val message: String,
    val time: Date,
) : Parcelable {
    @Serializable
    enum class Level {
        @SerialName("debug")
        Debug,
        @SerialName("info")
        Info,
        @SerialName("warning")
        Warning,
        @SerialName("error")
        Error,
        @SerialName("silent")
        Silent,
        @SerialName("unknown")
        Unknown,
    }

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        Parcelizer.encodeToParcel(serializer(), parcel, this)
    }

    override fun describeContents(): Int {
        return 0
    }

    companion object {
        @JvmField
        val CREATOR = object : Parcelable.Creator<LogMessage> {
            override fun createFromParcel(parcel: Parcel): LogMessage {
                return Parcelizer.decodeFromParcel(serializer(), parcel)
            }

            override fun newArray(size: Int): Array<LogMessage?> {
                return arrayOfNulls(size)
            }
        }
    }
}