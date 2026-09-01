package br.com.botadmin.flutter_panel

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream

object BotAdminMediaSaver {
    private const val REQUEST_WRITE_STORAGE = 9174
    private var pendingArgs: Map<*, *>? = null
    private var pendingResult: MethodChannel.Result? = null

    fun save(activity: Activity, args: Map<*, *>, result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            if (pendingResult != null) {
                result.error("MEDIA_SAVE_BUSY", "Já existe um salvamento aguardando permissão.", null)
                return
            }
            pendingArgs = args
            pendingResult = result
            activity.requestPermissions(
                arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
                REQUEST_WRITE_STORAGE,
            )
            return
        }
        performSave(activity, args, result)
    }

    fun onRequestPermissionsResult(
        activity: Activity,
        requestCode: Int,
        grantResults: IntArray,
    ): Boolean {
        if (requestCode != REQUEST_WRITE_STORAGE) return false
        val args = pendingArgs
        val result = pendingResult
        pendingArgs = null
        pendingResult = null
        if (args == null || result == null) return true
        if (grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED) {
            result.error("MEDIA_PERMISSION_DENIED", "Permissão para salvar arquivos negada.", null)
            return true
        }
        performSave(activity, args, result)
        return true
    }

    private fun performSave(activity: Activity, args: Map<*, *>, result: MethodChannel.Result) {
        val bytes = args["bytes"] as? ByteArray
        val requestedName = args["fileName"]?.toString().orEmpty()
        val mimeType = args["mimeType"]?.toString()?.takeIf { it.isNotBlank() }
            ?: "application/octet-stream"
        if (bytes == null || bytes.isEmpty()) {
            result.error("MEDIA_EMPTY", "A mídia recebida está vazia.", null)
            return
        }
        val safeName = sanitizeFileName(requestedName, mimeType)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(
                        MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/BotAdmin",
                    )
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val resolver = activity.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: error("Não foi possível criar o arquivo em Downloads.")
                try {
                    resolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
                        ?: error("Não foi possível abrir o arquivo para gravação.")
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                } catch (error: Throwable) {
                    resolver.delete(uri, null, null)
                    throw error
                }
            } else {
                @Suppress("DEPRECATION")
                val downloads = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS,
                )
                val folder = File(downloads, "BotAdmin").apply { mkdirs() }
                FileOutputStream(File(folder, safeName)).use { it.write(bytes) }
            }
            mapOf(
                "saved" to true,
                "displayPath" to "Downloads/BotAdmin/$safeName",
                "fileName" to safeName,
            )
        }.fold(
            onSuccess = result::success,
            onFailure = { result.error("MEDIA_SAVE_FAILED", it.message, null) },
        )
    }

    private fun sanitizeFileName(value: String, mimeType: String): String {
        val clean = value.trim().replace(Regex("[^a-zA-Z0-9._-]+"), "-")
            .trim('-', '.')
        if (clean.isNotBlank() && clean.contains('.')) return clean.takeLast(120)
        val extension = when {
            mimeType.contains("jpeg") -> "jpg"
            mimeType.contains("png") -> "png"
            mimeType.contains("webp") -> "webp"
            mimeType.contains("gif") -> "gif"
            mimeType.contains("mp4") -> "mp4"
            mimeType.contains("webm") -> "webm"
            mimeType.contains("mpeg") -> "mp3"
            mimeType.contains("ogg") -> "ogg"
            mimeType.contains("pdf") -> "pdf"
            else -> "bin"
        }
        return "${clean.ifBlank { "botadmin-${System.currentTimeMillis()}" }}.$extension"
    }
}
