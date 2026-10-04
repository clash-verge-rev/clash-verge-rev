package com.github.kr328.clash.service.data

import androidx.room.*
import java.util.*

@Dao
@TypeConverters(Converters::class)
interface SelectionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun setSelected(selection: Selection)

    @Query("DELETE FROM selections WHERE uuid = :uuid AND proxy = :proxy")
    fun removeSelected(uuid: UUID, proxy: String)

    @Query("SELECT * FROM selections WHERE uuid = :uuid")
    suspend fun querySelections(uuid: UUID): List<Selection>

    @Query("DELETE FROM selections WHERE uuid = :uuid AND proxy in (:proxies)")
    suspend fun removeSelections(uuid: UUID, proxies: List<String>)
}
