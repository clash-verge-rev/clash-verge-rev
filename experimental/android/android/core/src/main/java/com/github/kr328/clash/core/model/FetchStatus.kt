package com.github.kr328.clash.core.model

import android.os.Parcel
import android.os.Parcelable
import com.github.kr328.clash.core.util.Parcelizer
import kotlinx.serialization.Serializable

@Serializable
data class FetchStatus(
    val action: Action,
    val args: List<String>,
    val progress: Int,
    val max: Int,
    val subUpload: Long? = null,
    val subDownload: Long? = null,
    val subTotal: Long? = null,
    val subExpire: Long? = null,
    val subUpdateInterval: Long? = null,
) : Parcelable {
    enum class Action {
        FetchConfiguration,
        FetchProviders,
        SubscriptionInfo,
        Verifying,
    }

    override fun describeContents(): Int {
        return 0
    }

    override fun writeToParcel(dest: Parcel, flags: Int) {
        Parcelizer.encodeToParcel(serializer(), dest, this)
    }

    companion object CREATOR : Parcelable.Creator<FetchStatus> {
        override fun createFromParcel(parcel: Parcel): FetchStatus {
            return Parcelizer.decodeFromParcel(serializer(), parcel)
        }

        override fun newArray(size: Int): Array<FetchStatus?> {
            return arrayOfNulls(size)
        }
    }
}
