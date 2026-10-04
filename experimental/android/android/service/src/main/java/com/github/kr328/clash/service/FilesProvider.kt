package com.github.kr328.clash.service

import android.database.Cursor
import android.database.MatrixCursor
import android.os.Build
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract.Root
import android.provider.DocumentsProvider
import com.github.kr328.clash.common.util.PatternFileName
import com.github.kr328.clash.service.document.*
import kotlinx.coroutines.runBlocking
import java.io.FileNotFoundException
import android.provider.DocumentsContract.Document as D

class FilesProvider : DocumentsProvider() {
    companion object {
        private const val DEFAULT_ROOT_ID = "0"

        private val DEFAULT_DOCUMENT_COLUMNS = arrayOf(
            D.COLUMN_DOCUMENT_ID,
            D.COLUMN_DISPLAY_NAME,
            D.COLUMN_MIME_TYPE,
            D.COLUMN_LAST_MODIFIED,
            D.COLUMN_SIZE,
            D.COLUMN_FLAGS
        )
        private val DEFAULT_ROOT_COLUMNS = arrayOf(
            Root.COLUMN_ROOT_ID,
            Root.COLUMN_FLAGS,
            Root.COLUMN_ICON,
            Root.COLUMN_TITLE,
            Root.COLUMN_SUMMARY,
            Root.COLUMN_DOCUMENT_ID
        )

        private val FLAG_VIRTUAL: Int =
            if (Build.VERSION.SDK_INT >= 24) D.FLAG_VIRTUAL_DOCUMENT else 0
    }

    private val picker: Picker by lazy {
        Picker(context!!)
    }

    override fun openDocument(
        documentId: String?,
        mode: String?,
        signal: CancellationSignal?
    ): ParcelFileDescriptor {
        val m = ParcelFileDescriptor.parseMode(mode)

        return runBlocking {
            val path = Paths.resolve(documentId ?: "/")

            val document = picker.pick(path, mode?.requestWrite ?: true)

            require(document is FileDocument) {
                throw FileNotFoundException("invalid path $documentId")
            }

            ParcelFileDescriptor.open(document.file, m)
        }
    }

    override fun deleteDocument(documentId: String?) {
        val documentPath = documentId ?: "/"

        runBlocking {
            val path = Paths.resolve(documentPath)

            if (path.relative == null)
                throw IllegalArgumentException("invalid path $documentId")

            val document = picker.pick(path, true)

            require(document is FileDocument) {
                throw FileNotFoundException("invalid path $documentId")
            }

            document.file.deleteRecursively()
        }
    }

    override fun renameDocument(documentId: String?, displayName: String?): String {
        val name = displayName ?: ""

        if (!PatternFileName.matches(name))
            throw IllegalArgumentException("invalid name $displayName")

        return runBlocking {
            val path = Paths.resolve(documentId ?: "/")

            if (path.relative == null)
                throw IllegalArgumentException("unable to rename $documentId")

            val document = picker.pick(path, true)

            require(document is FileDocument) {
                throw IllegalArgumentException("unable to rename $document")
            }

            val parent = document.file.parentFile

            require(parent != null) {
                throw IllegalArgumentException("unable to rename $document")
            }

            document.file.renameTo(parent.resolve(name))

            path.copy(relative = path.relative.dropLast(1) + name).toString()
        }
    }

    override fun queryChildDocuments(
        parentDocumentId: String?,
        projection: Array<out String>?,
        sortOrder: String?
    ): Cursor {
        return runBlocking {
            try {
                val doc = parentDocumentId ?: "/"
                val path = Paths.resolve(doc)
                val documents = picker.list(path)

                MatrixCursor(resolveDocumentProjection(projection)).apply {
                    documents.forEach {
                        newRow().applyDocument(it)
                            .add(D.COLUMN_DOCUMENT_ID, "$doc/${it.id}")
                    }
                }
            } catch (e: Exception) {
                MatrixCursor(resolveDocumentProjection(projection))
            }
        }
    }

    override fun queryDocument(documentId: String?, projection: Array<out String>?): Cursor {
        return runBlocking {
            try {
                val doc = documentId ?: "/"
                val path = Paths.resolve(doc)
                val document = picker.pick(path, false)

                MatrixCursor(resolveDocumentProjection(projection)).apply {
                    newRow().applyDocument(document).add(D.COLUMN_DOCUMENT_ID, doc)
                }
            } catch (e: Exception) {
                MatrixCursor(resolveDocumentProjection(projection))
            }
        }
    }

    override fun onCreate(): Boolean {
        return true
    }

    override fun queryRoots(projection: Array<out String>?): Cursor {
        val flags = Root.FLAG_LOCAL_ONLY or Root.FLAG_SUPPORTS_IS_CHILD

        return MatrixCursor(projection ?: DEFAULT_ROOT_COLUMNS).apply {
            newRow().apply {
                add(Root.COLUMN_ROOT_ID, DEFAULT_ROOT_ID)
                add(Root.COLUMN_FLAGS, flags)
                add(Root.COLUMN_ICON, R.drawable.ic_logo_service)
                add(Root.COLUMN_TITLE, context!!.getString(R.string.clash_meta_for_android))
                add(Root.COLUMN_SUMMARY, context!!.getString(R.string.profiles_and_providers))
                add(Root.COLUMN_DOCUMENT_ID, "/")
                add(Root.COLUMN_MIME_TYPES, D.MIME_TYPE_DIR)
            }
        }
    }

    override fun isChildDocument(parentDocumentId: String?, documentId: String?): Boolean {
        if (parentDocumentId == null || documentId == null)
            return false

        return documentId.startsWith(parentDocumentId)
    }

    private fun MatrixCursor.RowBuilder.applyDocument(document: Document): MatrixCursor.RowBuilder {
        var flags = 0

        document.flags.forEach {
            flags = when (it) {
                Flag.Writable -> flags or D.FLAG_SUPPORTS_WRITE
                Flag.Deletable -> flags or D.FLAG_SUPPORTS_DELETE
                Flag.Virtual -> flags or FLAG_VIRTUAL
            }
        }

        add(D.COLUMN_DISPLAY_NAME, document.name)
        add(D.COLUMN_MIME_TYPE, document.mimeType)
        add(D.COLUMN_LAST_MODIFIED, document.updatedAt)
        add(D.COLUMN_SIZE, document.size)
        add(D.COLUMN_FLAGS, flags)

        return this
    }

    private fun resolveDocumentProjection(projection: Array<out String>?): Array<out String> {
        return projection ?: DEFAULT_DOCUMENT_COLUMNS
    }

    private val String.requestWrite: Boolean
        get() {
            return contains("w", ignoreCase = true)
        }
}