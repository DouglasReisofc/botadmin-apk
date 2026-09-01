package br.com.botadmin.flutter_panel

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val RealtimePrefsName = "botadmin_native_realtime"
private const val RealtimePrefsBaseUrl = "base_url"
private const val RealtimePrefsCookie = "cookie"
private const val RealtimePrefsSequence = "sequence"
private const val RealtimePrefsPrimed = "primed"
private const val RealtimeServiceChannelId = "botadmin_realtime_service_v2"
private const val RealtimeServiceNotificationId = 1701
private const val RealtimeStopAction = "br.com.botadmin.flutter_panel.REALTIME_STOP"

class BotAdminRealtimeNotificationService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var running = false

    @Volatile
    private var loopStarted = false

    override fun onCreate() {
        super.onCreate()
        ensureServiceChannel()
        val notification = buildForegroundNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                RealtimeServiceNotificationId,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(RealtimeServiceNotificationId, notification)
        }
        running = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == RealtimeStopAction) {
            stopSelf()
            return START_NOT_STICKY
        }
        startLoop()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startLoop() {
        if (loopStarted) return
        loopStarted = true
        executor.execute { pollLoop() }
    }

    private fun pollLoop() {
        var delayMs = 2500L
        while (running) {
            try {
                val prefs = getSharedPreferences(RealtimePrefsName, Context.MODE_PRIVATE)
                val baseUrl = prefs.getString(RealtimePrefsBaseUrl, null)?.trim().orEmpty()
                val cookie = prefs.getString(RealtimePrefsCookie, null)?.trim().orEmpty()
                if (baseUrl.isBlank() || cookie.isBlank()) {
                    stopSelf()
                    return
                }

                val primed = prefs.getBoolean(RealtimePrefsPrimed, false)
                var sequence = prefs.getLong(RealtimePrefsSequence, 0L)
                val json = fetchEvents(baseUrl, cookie, if (primed) sequence else 0L, if (primed) 100 else 1)
                val latestSequence = json.optLong("latestSequenceId", sequence)
                val events = json.optJSONArray("events")

                if (!primed) {
                    prefs.edit()
                        .putBoolean(RealtimePrefsPrimed, true)
                        .putLong(RealtimePrefsSequence, max(sequence, latestSequence))
                        .apply()
                    delayMs = 2500L
                    sleep(delayMs)
                    continue
                }

                if (events != null) {
                    for (index in 0 until events.length()) {
                        val event = events.optJSONObject(index) ?: continue
                        val eventSequence = event.optLong("sequenceId", sequence)
                        if (eventSequence <= sequence) continue
                        sequence = eventSequence
                        maybeNotify(event)
                    }
                }

                prefs.edit()
                    .putLong(RealtimePrefsSequence, max(sequence, latestSequence))
                    .apply()
                delayMs = 2500L
            } catch (error: InterruptedException) {
                return
            } catch (error: Throwable) {
                Log.w("BotAdminRealtime", "Realtime notification poll failed", error)
                delayMs = min(delayMs * 2L, 30000L)
            }
            sleep(delayMs)
        }
    }

    private fun fetchEvents(baseUrl: String, cookie: String, after: Long, limit: Int): JSONObject {
        val normalizedBase = baseUrl.trimEnd('/')
        val url = "$normalizedBase/api/whatsapp-realtime/events?after=$after&limit=$limit"
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/json")
            .header("Cookie", cookie)
            .header("X-BotAdmin-Mobile", "flutter-native-realtime")
            .build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                if (response.code == 401) {
                    clearConfig(this)
                    stopSelf()
                }
                throw IllegalStateException("HTTP ${response.code}")
            }
            return JSONObject(body.ifBlank { "{}" })
        }
    }

    private fun maybeNotify(event: JSONObject) {
        val eventType = event.optString("eventType", event.optString("type", ""))
        if (!eventType.equals("conversation.message.upserted", ignoreCase = true)) return

        val payload = event.optJSONObject("payload")
        val message = event.optJSONObject("message") ?: payload?.optJSONObject("message") ?: return
        val direction = message.optString("direction", "")
        if (direction.equals("outbound", ignoreCase = true) || message.optBoolean("mine", false)) return

        val thread = event.optJSONObject("thread") ?: payload?.optJSONObject("thread")
        val chatJid = firstNonBlank(event.optString("chatJid"), message.optString("chatJid"))
        if (chatJid.equals("status@broadcast", ignoreCase = true)) return

        val senderJid = firstNonBlank(
            message.optString("senderJid"),
            message.optString("participantJid"),
            message.optString("from")
        )
        val senderPhone = firstNonBlank(
            message.optString("senderPhone"),
            phoneFromJid(senderJid)
        )
        val senderName = firstNonBlank(
            message.optString("senderName"),
            message.optString("pushName"),
            message.optString("participantName")
        )
        val preview = firstNonBlank(
            message.optString("text"),
            thread?.optString("lastMessagePreview"),
            previewForType(message)
        )
        val chatTitle = firstNonBlank(
            thread?.optString("title"),
            message.optString("chatTitle"),
            if (chatJid.endsWith("@g.us", ignoreCase = true)) chatJid.substringBefore("@") else senderName,
            senderPhone,
            "Nova mensagem"
        )
        val avatarUrl = firstNonBlank(
            thread?.optString("avatarUrl"),
            thread?.optString("avatar_url"),
            message.optString("avatarUrl"),
            message.optString("avatar_url")
        )

        BotAdminMessageNotifier.showWhatsappMessage(
            this,
            mapOf(
                "type" to "whatsapp_message",
                "notificationId" to firstNonBlank(event.optString("messageId"), "$chatJid:${event.optLong("sequenceId", 0)}"),
                "chatTitle" to chatTitle,
                "senderName" to senderName,
                "senderPhone" to senderPhone,
                "messagePreview" to preview.ifBlank { "Mensagem recebida" },
                "chatJid" to chatJid,
                "avatarUrl" to avatarUrl,
                "instanceId" to event.optLong("instanceId", 0).toString(),
                "timestamp" to timestampMillis(event, message).toString(),
            )
        )
    }

    private fun timestampMillis(event: JSONObject, message: JSONObject): Long {
        val values = listOf(
            message.optString("timestamp"),
            event.optString("occurredAt"),
            event.optString("createdAt")
        )
        for (value in values) {
            val parsed = runCatching { java.time.Instant.parse(value).toEpochMilli() }.getOrNull()
            if (parsed != null) return parsed
        }
        return System.currentTimeMillis()
    }

    private fun previewForType(message: JSONObject): String {
        val type = firstNonBlank(
            message.optString("messageType"),
            message.optString("type"),
            message.optJSONObject("media")?.optString("mediaType")
        ).lowercase()
        return when {
            type.contains("image") -> "Imagem"
            type.contains("video") -> "Video"
            type.contains("audio") || type.contains("ptt") -> "Audio"
            type.contains("sticker") -> "Sticker"
            type.contains("document") -> "Documento"
            else -> "Mensagem recebida"
        }
    }

    private fun buildForegroundNotification(): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            1701,
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, RealtimeServiceChannelId)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("BotAdmin")
            .setContentText("Ativo")
            .setOngoing(true)
            .setDefaults(0)
            .setSound(null)
            .setVibrate(null)
            .setShowWhen(false)
            .setLocalOnly(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(Notification.PRIORITY_MIN)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun ensureServiceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.deleteNotificationChannel("botadmin_realtime_service_v1")
        if (manager.getNotificationChannel(RealtimeServiceChannelId) == null) {
            manager.createNotificationChannel(
                NotificationChannel(
                    RealtimeServiceChannelId,
                    "BotAdmin",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Servico interno do BotAdmin."
                    setShowBadge(false)
                    setSound(null, null)
                    enableVibration(false)
                }
            )
        }
    }

    private fun sleep(delayMs: Long) {
        try {
            Thread.sleep(delayMs)
        } catch (error: InterruptedException) {
            throw error
        }
    }

    companion object {
        fun configure(context: Context, baseUrl: String, cookie: String) {
            val appContext = context.applicationContext
            // O app agora usa FCM nativo como fonte principal de push.
            // Manter um foreground service de polling cria uma notificacao
            // persistente/canal extra no Android; por isso limpamos qualquer
            // configuracao legada e nao iniciamos mais este fallback.
            clearConfig(appContext)
        }

        fun clearConfig(context: Context) {
            val appContext = context.applicationContext
            appContext.getSharedPreferences(RealtimePrefsName, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
            val intent = Intent(appContext, BotAdminRealtimeNotificationService::class.java)
                .setAction(RealtimeStopAction)
            runCatching { appContext.stopService(intent) }
            runCatching {
                val manager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.cancel(RealtimeServiceNotificationId)
            }
        }

        fun startIfConfigured(context: Context) {
            clearConfig(context.applicationContext)
        }

        private fun start(context: Context) {
            val intent = Intent(context, BotAdminRealtimeNotificationService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}

class BotAdminBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_MY_PACKAGE_REPLACED && action != Intent.ACTION_BOOT_COMPLETED) return
        runCatching { BotAdminRealtimeNotificationService.startIfConfigured(context) }
    }
}

private fun firstNonBlank(vararg values: String?): String {
    for (value in values) {
        val normalized = value?.trim().orEmpty()
        if (normalized.isNotBlank() && !normalized.equals("null", ignoreCase = true)) return normalized
    }
    return ""
}

private fun phoneFromJid(jid: String): String =
    jid.substringBefore("@").filter { it.isDigit() || it == '+' }
