package com.github.kr328.clash.service.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.TypeConverters
import java.util.*

@Entity(
    tableName = "selections",
    foreignKeys = [ForeignKey(
        entity = Imported::class,
        childColumns = ["uuid"],
        parentColumns = ["uuid"],
        onDelete = ForeignKey.CASCADE,
        onUpdate = ForeignKey.CASCADE
    )],
    primaryKeys = ["uuid", "proxy"]
)
@TypeConverters(Converters::class)
data class Selection(
    @ColumnInfo(name = "uuid") val uuid: UUID,
    @ColumnInfo(name = "proxy") val proxy: String,
    @ColumnInfo(name = "selected") val selected: String,
)