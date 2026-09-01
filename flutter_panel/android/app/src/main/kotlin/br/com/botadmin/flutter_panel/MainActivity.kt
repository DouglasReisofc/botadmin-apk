package br.com.botadmin.flutter_panel

import android.content.Intent
import android.provider.Settings
import android.provider.ContactsContract
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "botadmin/native")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "deviceId" -> {
                        val androidId = Settings.Secure.getString(
                            applicationContext.contentResolver,
                            Settings.Secure.ANDROID_ID
                        )
                        result.success(
                            androidId?.takeIf { it.isNotBlank() }
                                ?: "android-${android.os.Build.MODEL}-${android.os.Build.ID}".hashCode()
                                    .let { kotlin.math.abs(it).toString() }
                        )
                    }
                    "consumeNativeInbox" -> result.success(BotAdminNativeInbox.consume(applicationContext))
                    "configureRealtimeNotifications" -> {
                        val baseUrl = call.argument<String>("baseUrl")?.trim().orEmpty()
                        val cookie = call.argument<String>("cookie")?.trim().orEmpty()
                        if (baseUrl.isBlank() || cookie.isBlank()) {
                            result.success(false)
                            return@setMethodCallHandler
                        }
                        runCatching {
                            BotAdminRealtimeNotificationService.configure(
                                applicationContext,
                                baseUrl,
                                cookie
                            )
                        }.fold(
                            onSuccess = { result.success(true) },
                            onFailure = { result.error("REALTIME_START_FAILED", it.message, null) }
                        )
                    }
                    "stopRealtimeNotifications" -> {
                        BotAdminRealtimeNotificationService.clearConfig(applicationContext)
                        result.success(true)
                    }
                    "saveContact" -> {
                        val displayName = call.argument<String>("displayName")?.trim().orEmpty()
                        val phoneNumber = call.argument<String>("phoneNumber")?.trim().orEmpty()
                        if (displayName.isBlank() && phoneNumber.isBlank()) {
                            result.success(false)
                            return@setMethodCallHandler
                        }
                        runCatching {
                            val intent = Intent(ContactsContract.Intents.Insert.ACTION).apply {
                                type = ContactsContract.RawContacts.CONTENT_TYPE
                                putExtra(ContactsContract.Intents.Insert.NAME, displayName)
                                putExtra(ContactsContract.Intents.Insert.PHONE, phoneNumber)
                                putExtra(
                                    ContactsContract.Intents.Insert.PHONE_TYPE,
                                    ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE,
                                )
                            }
                            startActivity(intent)
                        }.fold(
                            onSuccess = { result.success(true) },
                            onFailure = {
                                result.error("CONTACT_SAVE_FAILED", it.message, null)
                            },
                        )
                    }
                    "saveMediaToDownloads" -> {
                        @Suppress("UNCHECKED_CAST")
                        BotAdminMediaSaver.save(
                            this,
                            (call.arguments as? Map<*, *>) ?: emptyMap<String, Any>(),
                            result,
                        )
                    }
                    "startUpdateDownload" -> {
                        val url = call.argument<String>("url")?.trim().orEmpty()
                        val fileName = call.argument<String>("fileName")?.trim().orEmpty()
                        val versionCode = call.argument<Number>("versionCode")?.toLong() ?: 0L
                        if (url.isBlank() || versionCode <= 0L) {
                            result.error("INVALID_UPDATE", "Link ou versão inválida.", null)
                            return@setMethodCallHandler
                        }
                        runCatching {
                            BotAdminUpdateManager.start(
                                applicationContext,
                                url,
                                fileName,
                                versionCode,
                            )
                        }.fold(
                            onSuccess = result::success,
                            onFailure = {
                                result.error("UPDATE_DOWNLOAD_FAILED", it.message, null)
                            },
                        )
                    }
                    "getUpdateDownloadStatus" -> {
                        val versionCode = call.argument<Number>("versionCode")?.toLong() ?: 0L
                        result.success(
                            BotAdminUpdateManager.status(applicationContext, versionCode),
                        )
                    }
                    "installDownloadedUpdate" -> {
                        val versionCode = call.argument<Number>("versionCode")?.toLong() ?: 0L
                        runCatching {
                            BotAdminUpdateManager.install(applicationContext, versionCode)
                        }.fold(
                            onSuccess = result::success,
                            onFailure = {
                                result.error("UPDATE_INSTALL_FAILED", it.message, null)
                            },
                        )
                    }
                    "start" -> {
                        @Suppress("UNCHECKED_CAST")
                        BotAdminCallAudioManager.start(
                            this,
                            (call.arguments as? Map<*, *>) ?: emptyMap<String, Any>(),
                            result,
                        )
                    }
                    "stop" -> result.success(BotAdminCallAudioManager.stop())
                    "speakerphone" -> result.success(
                        BotAdminCallAudioManager.setSpeakerphone(
                            call.argument<Boolean>("enabled") == true,
                        ),
                    )
                    "microphoneMuted" -> result.success(
                        BotAdminCallAudioManager.setMicrophoneMuted(
                            call.argument<Boolean>("muted") == true,
                        ),
                    )
                    "current" -> result.success(BotAdminCallAudioManager.current())
                    else -> result.notImplemented()
                }
            }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        if (BotAdminCallAudioManager.onRequestPermissionsResult(requestCode, grantResults)) return
        if (BotAdminMediaSaver.onRequestPermissionsResult(this, requestCode, grantResults)) return
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }
}
