package com.github.kr328.clash

import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import com.github.kr328.clash.core.Clash
import com.github.kr328.clash.design.MetaFeatureSettingsDesign
import com.github.kr328.clash.util.clashDir
import com.github.kr328.clash.util.withClash
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.selects.select
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import com.github.kr328.clash.design.R


class MetaFeatureSettingsActivity : BaseActivity<MetaFeatureSettingsDesign>() {
    override suspend fun main() {
        val configuration = withClash { queryOverride(Clash.OverrideSlot.Persist) }

        defer {
            withClash {
                patchOverride(Clash.OverrideSlot.Persist, configuration)
            }
        }

        val design = MetaFeatureSettingsDesign(
            this,
            configuration
        )

        setContentDesign(design)

        while (isActive) {
            select<Unit> {
                events.onReceive {

                }
                design.requests.onReceive {
                    when (it) {
                        MetaFeatureSettingsDesign.Request.ResetOverride -> {
                            if (design.requestResetConfirm()) {
                                defer {
                                    withClash {
                                        clearOverride(Clash.OverrideSlot.Persist)
                                    }
                                }
                                finish()
                            }
                        }
                        MetaFeatureSettingsDesign.Request.ImportGeoIp -> {
                            val uri = startActivityForResult(
                                ActivityResultContracts.GetContent(),
                                "*/*")
                            importGeoFile(uri, MetaFeatureSettingsDesign.Request.ImportGeoIp)
                        }
                        MetaFeatureSettingsDesign.Request.ImportGeoSite -> {
                            val uri = startActivityForResult(
                                ActivityResultContracts.GetContent(),
                                "*/*")
                            importGeoFile(uri, MetaFeatureSettingsDesign.Request.ImportGeoSite)
                        }
                        MetaFeatureSettingsDesign.Request.ImportCountry -> {
                            val uri = startActivityForResult(
                                ActivityResultContracts.GetContent(),
                                "*/*")
                            importGeoFile(uri, MetaFeatureSettingsDesign.Request.ImportCountry)
                        }
                        MetaFeatureSettingsDesign.Request.ImportASN -> {
                            val uri = startActivityForResult(
                                ActivityResultContracts.GetContent(),
                                "*/*")
                            importGeoFile(uri, MetaFeatureSettingsDesign.Request.ImportASN)
                        }
                    }
                }
            }
        }
    }

    private val validDatabaseExtensions = listOf(
        ".metadb", ".db", ".dat", ".mmdb"
    )

    private suspend fun importGeoFile(uri: Uri?, importType: MetaFeatureSettingsDesign.Request) {
        val cursor: Cursor? = uri?.let {
            contentResolver.query(it, null, null, null, null, null)
        }
        cursor?.use {
            if (it.moveToFirst()) {
                val columnIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val displayName: String =
                    if (columnIndex != -1) it.getString(columnIndex) else "";
                val ext = "." + displayName.substringAfterLast(".")

                if (!validDatabaseExtensions.contains(ext)) {
                    MaterialAlertDialogBuilder(this)
                        .setTitle(R.string.geofile_unknown_db_format)
                        .setMessage(getString(R.string.geofile_unknown_db_format_message,
                            validDatabaseExtensions.joinToString("/")))
                        .setPositiveButton("OK") { _, _ -> }
                        .show()
                    return
                }
                val outputFileName = when (importType) {
                    MetaFeatureSettingsDesign.Request.ImportGeoIp ->
                        "geoip$ext"
                    MetaFeatureSettingsDesign.Request.ImportGeoSite ->
                        "geosite$ext"
                    MetaFeatureSettingsDesign.Request.ImportCountry ->
                        "country$ext"
                    MetaFeatureSettingsDesign.Request.ImportASN ->
                        "ASN$ext"
                    else -> ""
                }

                withContext(Dispatchers.IO) {
                    val outputFile = File(clashDir, outputFileName);
                    contentResolver.openInputStream(uri).use { ins ->
                        FileOutputStream(outputFile).use { outs ->
                            ins?.copyTo(outs)
                        }
                    }
                }
                Toast.makeText(this, getString(R.string.geofile_imported, displayName),
                    Toast.LENGTH_LONG).show()
                return
            }
        }
        Toast.makeText(this, R.string.geofile_import_failed, Toast.LENGTH_LONG).show()
    }
}