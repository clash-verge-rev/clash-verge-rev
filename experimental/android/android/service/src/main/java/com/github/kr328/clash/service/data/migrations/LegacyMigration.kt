@file:Suppress("BlockingMethodInNonBlockingContext")

package com.github.kr328.clash.service.data.migrations

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.core.text.isDigitsOnly
import com.github.kr328.clash.common.log.Log
import com.github.kr328.clash.service.data.Pending
import com.github.kr328.clash.service.data.PendingDao
import com.github.kr328.clash.service.model.Profile
import com.github.kr328.clash.service.util.generateProfileUUID
import com.github.kr328.clash.service.util.pendingDir
import com.github.kr328.clash.service.util.sendProfileChanged
import java.io.File

internal suspend fun migrationFromLegacy(context: Context) {
    val file = context.getDatabasePath("clash-config")

    if (!file.exists()) {
        return
    }

    Log.i("Migration from legacy database")

    try {
        SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
            .use { db ->
                val v = db.version

                Log.i("Legacy database version = $v")

                when (v) {
                    1 -> migrationFromLegacy1(context, db)
                    2, 3, 4 -> migrationFromLegacy234(context, db, v)
                }
            }
    } catch (e: Exception) {
        Log.w("Migration legacy database: $e", e)
    }

    context.deleteDatabase("clash-config")

    Log.i("Legacy database migrated")
}

private suspend fun migrationFromLegacy234(
    context: Context,
    legacy: SQLiteDatabase,
    version: Int,
) {
    legacy.query(
        "profiles",
        arrayOf("id", "name", "type", "uri", if (version == 2) "update_interval" else "interval"),
        null,
        null,
        null,
        null,
        "id"
    ).use { cursor ->
        val id = cursor.getColumnIndex("id")
        val name = cursor.getColumnIndex("name")
        val type = cursor.getColumnIndex("type")
        val uri = cursor.getColumnIndex("uri")
        val interval = cursor.getColumnIndex(if (version == 2) "update_interval" else "interval")

        if (!cursor.moveToFirst())
            return

        do {
            val newType = when (cursor.getInt(type)) {
                1 -> { // TYPE_FILE
                    Profile.Type.File
                }
                2 -> { // TYPE_URL
                    Profile.Type.Url
                }
                3 -> { // TYPE_EXTERNAL
                    Profile.Type.External
                }
                else -> { // unknown
                    continue
                }
            }

            val idValue = cursor.getInt(id)
            val intervalValue = cursor.getLong(interval)

            val pending = Pending(
                uuid = generateProfileUUID(),
                name = cursor.getString(name),
                type = newType,
                source = if (newType != Profile.Type.File) cursor.getString(uri) else "",
                interval = if (version == 2) intervalValue * 1000 else intervalValue,
                0,0,0,0
                )

            val base = context.pendingDir.resolve(pending.uuid.toString())

            base.apply {
                mkdirs()

                resolve("config.yaml").createNewFile()
                resolve("providers").mkdir()
            }

            if (newType == Profile.Type.File) {
                val legacyFile = context.filesDir.resolve("profiles/$idValue.yaml")

                if (legacyFile.isFile) {
                    legacyFile.copyTo(base.resolve("config.yaml"), overwrite = true)
                }
            }

            PendingDao().insert(pending)

            context.sendProfileChanged(pending.uuid)

            Log.i("${pending.name} migrated")
        } while (cursor.moveToNext())
    }

    context.filesDir.resolve("profiles").deleteRecursively()
    context.filesDir.resolve("clash").listFiles()?.forEach {
        if (it.name.isDigitsOnly()) {
            it.deleteRecursively()
        }
    }
}

private suspend fun migrationFromLegacy1(context: Context, legacy: SQLiteDatabase) {
    legacy.query(
        "profiles",
        arrayOf("name", "token", "id", "file"),
        null,
        null,
        null,
        null,
        "id",
    ).use { cursor ->
        val name = cursor.getColumnIndex("name")
        val token = cursor.getColumnIndex("token")
        val file = cursor.getColumnIndex("file")

        if (!cursor.moveToFirst())
            return

        do {
            val legacyToken = cursor.getString(token)

            val newType = when {
                legacyToken.startsWith("file|") -> Profile.Type.File
                legacyToken.startsWith("url|") -> Profile.Type.Url
                else -> continue
            }

            val source = if (newType == Profile.Type.Url) {
                legacyToken.removePrefix("url|")
            } else {
                ""
            }

            val pending = Pending(
                uuid = generateProfileUUID(),
                name = cursor.getString(name),
                type = newType,
                source = source,
                interval = 0,
                0,0,0,0
            )

            val base = context.pendingDir.resolve(pending.uuid.toString())

            base.apply {
                mkdirs()

                resolve("config.yaml").createNewFile()
                resolve("providers").mkdir()
            }

            val legacyFile = File(cursor.getString(file))

            if (newType == Profile.Type.File) {
                if (legacyFile.isFile) {
                    legacyFile.copyTo(base.resolve("config.yaml"), overwrite = true)
                }
            }

            legacyFile.delete()

            PendingDao().insert(pending)

            context.sendProfileChanged(pending.uuid)

            Log.i("${pending.name} migrated")
        } while (cursor.moveToNext())
    }
}
