package br.com.botadmin.flutter_panel

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment

object BotAdminUpdateManager {
    private const val PREFS = "botadmin_update_download"
    private const val KEY_ID = "download_id"
    private const val KEY_VERSION = "version_code"
    private const val KEY_FILE = "file_name"

    fun start(
        context: Context,
        url: String,
        fileName: String,
        versionCode: Long,
    ): Map<String, Any?> {
        val current = status(context, versionCode)
        val currentStatus = current["status"] as? String
        if (currentStatus in setOf("pending", "running", "paused", "successful")) {
            return current
        }

        clearPrevious(context)
        val safeName = fileName
            .ifBlank { "botadmin-$versionCode.apk" }
            .replace(Regex("[^A-Za-z0-9._-]"), "-")
        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle("Atualização BotAdmin")
            setDescription("Baixando a versão $versionCode")
            setMimeType("application/vnd.android.package-archive")
            setAllowedOverMetered(true)
            setAllowedOverRoaming(true)
            setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
            )
            addRequestHeader("Accept", "application/vnd.android.package-archive,*/*")
            setDestinationInExternalFilesDir(
                context,
                Environment.DIRECTORY_DOWNLOADS,
                safeName,
            )
        }
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val id = manager.enqueue(request)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(KEY_ID, id)
            .putLong(KEY_VERSION, versionCode)
            .putString(KEY_FILE, safeName)
            .apply()
        return status(context, versionCode)
    }

    fun status(context: Context, versionCode: Long): Map<String, Any?> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val storedVersion = prefs.getLong(KEY_VERSION, -1L)
        val id = prefs.getLong(KEY_ID, -1L)
        if (storedVersion != versionCode || id <= 0L) {
            return result("not_found", -1L, 0L, 0L, 0, false)
        }

        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val cursor = manager.query(DownloadManager.Query().setFilterById(id))
        cursor.use {
            if (it == null || !it.moveToFirst()) {
                prefs.edit().clear().apply()
                return result("not_found", -1L, 0L, 0L, 0, false)
            }
            val rawStatus = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val received = it.getLong(
                it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR),
            )
            val total = it.getLong(
                it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES),
            )
            val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
            val label = when (rawStatus) {
                DownloadManager.STATUS_PENDING -> "pending"
                DownloadManager.STATUS_RUNNING -> "running"
                DownloadManager.STATUS_PAUSED -> "paused"
                DownloadManager.STATUS_SUCCESSFUL -> "successful"
                DownloadManager.STATUS_FAILED -> "failed"
                else -> "not_found"
            }
            return result(
                label,
                id,
                received.coerceAtLeast(0L),
                total.coerceAtLeast(0L),
                reason,
                rawStatus == DownloadManager.STATUS_SUCCESSFUL &&
                    manager.getUriForDownloadedFile(id) != null,
            )
        }
    }

    fun install(context: Context, versionCode: Long): Boolean {
        val snapshot = status(context, versionCode)
        if (snapshot["status"] != "successful") return false
        val id = (snapshot["downloadId"] as? Number)?.toLong() ?: return false
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val uri = manager.getUriForDownloadedFile(id) ?: return false
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            data = uri
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
            putExtra(Intent.EXTRA_RETURN_RESULT, true)
        }
        context.startActivity(intent)
        return true
    }

    private fun clearPrevious(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = prefs.getLong(KEY_ID, -1L)
        if (id > 0L) {
            val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            runCatching { manager.remove(id) }
        }
        val fileName = prefs.getString(KEY_FILE, null)
        if (!fileName.isNullOrBlank()) {
            runCatching {
                context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    ?.resolve(fileName)
                    ?.delete()
            }
        }
        prefs.edit().clear().apply()
    }

    private fun result(
        status: String,
        id: Long,
        received: Long,
        total: Long,
        reason: Int,
        canInstall: Boolean,
    ): Map<String, Any?> = mapOf(
        "status" to status,
        "downloadId" to id,
        "receivedBytes" to received,
        "totalBytes" to total,
        "reason" to reason,
        "canInstall" to canInstall,
    )
}
