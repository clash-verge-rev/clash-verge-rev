package com.github.kr328.clash.core.model

import android.os.Parcel
import android.os.Parcelable
import com.github.kr328.clash.common.util.createListFromParcelSlice
import com.github.kr328.clash.common.util.writeToParcelSlice
import kotlinx.serialization.Serializable

@Serializable
data class ProxyGroup(
    val type: String,
    val proxies: List<Proxy>,
    val now: String,
) : Parcelable {
    class SliceProxyList(data: List<Proxy>) : List<Proxy> by data, Parcelable {
        constructor(parcel: Parcel) : this(Proxy.createListFromParcelSlice(parcel, 0, 50))

        override fun describeContents(): Int {
            return 0
        }

        override fun writeToParcel(dest: Parcel, flags: Int) {
            writeToParcelSlice(dest, flags)
        }

        companion object CREATOR : Parcelable.Creator<SliceProxyList> {
            override fun createFromParcel(parcel: Parcel): SliceProxyList {
                return SliceProxyList(parcel)
            }

            override fun newArray(size: Int): Array<SliceProxyList?> {
                return arrayOfNulls(size)
            }
        }
    }

    constructor(parcel: Parcel) : this(
        parcel.readString()!!,
        SliceProxyList(parcel),
        parcel.readString()!!,
    )

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeString(type)
        SliceProxyList(proxies).writeToParcel(parcel, 0)
        parcel.writeString(now)
    }

    override fun describeContents(): Int {
        return 0
    }

    companion object CREATOR : Parcelable.Creator<ProxyGroup> {
        override fun createFromParcel(parcel: Parcel): ProxyGroup {
            return ProxyGroup(parcel)
        }

        override fun newArray(size: Int): Array<ProxyGroup?> {
            return arrayOfNulls(size)
        }
    }
}