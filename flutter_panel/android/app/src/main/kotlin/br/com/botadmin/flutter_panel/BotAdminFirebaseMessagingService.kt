package br.com.botadmin.flutter_panel

import android.Manifest
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class BotAdminFirebaseMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val data = message.data
        BotAdminNativeInbox.enqueue(this, data)
        android.util.Log.d(
            "BotAdminFirebase",
            "FCM received type=${data["type"] ?: ""} keys=${data.keys.joinToString(",")}"
        )
        val pushType = data["type"].orEmpty()
        val shouldNotifyInForeground =
            pushType.equals("whatsapp_presence_online", ignoreCase = true) ||
                pushType.equals("whatsapp_call", ignoreCase = true)
        if (isAppInForeground() && !shouldNotifyInForeground) return
        if (pushType.equals("whatsapp_message", ignoreCase = true)) {
            BotAdminMessageNotifier.showWhatsappMessage(this, data)
            return
        }
        BotAdminMessageNotifier.showGeneric(this, message, data)
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        android.util.Log.d("BotAdminFirebase", "New FCM token: ${token.take(24)}")
    }

    private fun isAppInForeground(): Boolean {
        val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val processes = activityManager.runningAppProcesses ?: return false
        val currentPid = android.os.Process.myPid()
        return processes.any {
            it.pid == currentPid &&
                it.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        }
    }
}

/** Persists compact FCM events so a cold app can paint the latest previews
 * before making any HTTP request.  The Flutter side consumes and clears this
 * inbox on startup. */
object BotAdminNativeInbox {
    private const val PREFS = "botadmin_native_inbox"
    private const val EVENTS = "events"
    private const val MAX_EVENTS = 200

    fun enqueue(context: Context, data: Map<String, String>) {
        if (data["type"].orEmpty().isBlank()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = runCatching { org.json.JSONArray(prefs.getString(EVENTS, "[]")) }
            .getOrElse { org.json.JSONArray() }
        current.put(JSONObject(data))
        val start = (current.length() - MAX_EVENTS).coerceAtLeast(0)
        val trimmed = org.json.JSONArray()
        for (index in start until current.length()) trimmed.put(current.opt(index))
        prefs.edit().putString(EVENTS, trimmed.toString()).apply()
    }

    fun consume(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val value = prefs.getString(EVENTS, "[]") ?: "[]"
        prefs.edit().remove(EVENTS).apply()
        return value
    }
}

class BotAdminDebugNotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val data = mapOf(
            "type" to "whatsapp_message",
            "notificationId" to (
                intent.getStringExtra("notificationId")
                    ?: "adb-debug-${System.currentTimeMillis()}"
            ),
            "chatTitle" to (intent.getStringExtra("chatTitle") ?: "Grupo Vip da Ka"),
            "senderName" to (intent.getStringExtra("senderName") ?: "Tais"),
            "senderPhone" to (intent.getStringExtra("senderPhone") ?: "559299533643"),
            "messagePreview" to (intent.getStringExtra("messagePreview") ?: "teste de notificacao nativa"),
            "chatJid" to (intent.getStringExtra("chatJid") ?: "debug@g.us"),
            "avatarUrl" to (intent.getStringExtra("avatarUrl") ?: ""),
            "instanceId" to (intent.getStringExtra("instanceId") ?: "debug"),
            "timestamp" to System.currentTimeMillis().toString(),
        )
        BotAdminMessageNotifier.showWhatsappMessage(context, data)
    }
}

object BotAdminMessageNotifier {
    private const val MESSAGE_CHANNEL_ID = "botadmin_realtime_messages_v6"
    private const val MESSAGE_PREFS = "botadmin_whatsapp_notification_state"
    private const val MESSAGE_GROUP_KEY = "br.com.botadmin.flutter_panel.WHATSAPP_MESSAGES"
    private const val MESSAGE_PREFS_CHAT_KEYS = "chat_keys"
    private const val SUMMARY_NOTIFICATION_ID = 1001
    private const val REALTIME_SERVICE_NOTIFICATION_ID = 1701
    private const val STALE_WINDOW_MS = 30 * 60 * 1000L
    private const val MAX_RECENT_IDS = 24
    private const val MAX_RECENT_LINES = 6
    private const val SEPARATOR = "\u001E"
    private val avatarCache = ConcurrentHashMap<String, Bitmap>()
    private val avatarExecutor = Executors.newCachedThreadPool()

    fun showWhatsappMessage(context: Context, data: Map<String, String>) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureMessageChannel(notificationManager)

        val chatTitle = data["chatTitle"].orEmpty().ifBlank { "BotAdmin" }
        val senderName = data["senderName"].orEmpty()
        val senderPhone = data["senderPhone"].orEmpty()
        val preview = data["messagePreview"].orEmpty().ifBlank { "Nova mensagem" }
        val chatJid = data["chatJid"].orEmpty().ifBlank { chatTitle }
        val linePrefix = listOf(senderName, senderPhone)
            .filter { it.isNotBlank() }
            .joinToString(" - ")
        val body = if (linePrefix.isBlank()) preview else "$linePrefix: $preview"
        val contentIntent = buildContentIntent(context, data)
        val timestamp = data["timestamp"]?.toLongOrNull() ?: System.currentTimeMillis()
        val notificationId = data["notificationId"]
            ?: data["messageId"]
            ?: "$chatJid:$timestamp:$body"
        val chatKey = stableChatKey(data["instanceId"].orEmpty(), chatJid)
        val state = updateMessageState(context, chatKey, notificationId, body, timestamp) ?: return
        val chatNotificationId = 200_000 + kotlin.math.abs(chatKey.hashCode() % 700_000)
        val avatar = loadAvatar(data["avatarUrl"] ?: data["avatar_url"])
        android.util.Log.d(
            "BotAdminFirebase",
            "Posting grouped chat=$chatJid id=$chatNotificationId avatar=${avatar != null}"
        )
        val style = Notification.InboxStyle()
            .setBigContentTitle(chatTitle)
            .setSummaryText(if (state.count > 1) "${state.count} mensagens novas" else "BotAdmin")
        state.lines.forEach { style.addLine(it) }

        val notification = Notification.Builder(context, MESSAGE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(chatTitle)
            .setContentText(body)
            .setStyle(style)
            .setLargeIcon(avatar)
            .setShowWhen(true)
            .setWhen(timestamp)
            .setNumber(state.count)
            .setAutoCancel(true)
            .setOnlyAlertOnce(state.count > 1)
            .setContentIntent(contentIntent)
            .setGroup(MESSAGE_GROUP_KEY)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setPriority(Notification.PRIORITY_HIGH)
            .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
            .build()

        notificationManager.cancel(REALTIME_SERVICE_NOTIFICATION_ID)
        notificationManager.notify(chatNotificationId, notification)

        val summary = Notification.Builder(context, MESSAGE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("BotAdmin")
            .setContentText("${state.totalUnread} mensagens de ${state.totalChats} conversa${if (state.totalChats == 1) "" else "s"}")
            .setNumber(state.totalUnread)
            .setGroup(MESSAGE_GROUP_KEY)
            .setGroupSummary(true)
            .setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setPriority(Notification.PRIORITY_HIGH)
            .build()
        notificationManager.notify(SUMMARY_NOTIFICATION_ID, summary)
    }

    fun showGeneric(context: Context, message: RemoteMessage, data: Map<String, String>) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val title = message.notification?.title
            ?: data["storebot_title"]
            ?: data["title"]
            ?: "BotAdmin"
        val body = message.notification?.body
            ?: data["storebot_body"]
            ?: data["body"]
            ?: data["message"]
            ?: "Nova atualização recebida."
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureMessageChannel(notificationManager)
        val notification = Notification.Builder(context, MESSAGE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setAutoCancel(true)
            .setContentIntent(buildContentIntent(context, data))
            .setCategory(Notification.CATEGORY_STATUS)
            .setPriority(Notification.PRIORITY_HIGH)
            .build()
        val notificationId = data["storebot_notification_id"]
            ?: data["notificationId"]
            ?: data["notification_id"]
            ?: "generic:$title:$body"
        notificationManager.notify(kotlin.math.abs(notificationId.hashCode()), notification)
    }

    private fun buildContentIntent(context: Context, data: Map<String, String>): PendingIntent {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(context, MainActivity::class.java)
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        data["chatJid"]?.let { intent.putExtra("chatJid", it) }
        data["instanceId"]?.let { intent.putExtra("instanceId", it) }

        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        return PendingIntent.getActivity(context, 1200, intent, flags)
    }

    private fun ensureMessageChannel(notificationManager: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        notificationManager.deleteNotificationChannel("botadmin_realtime_service_v1")
        notificationManager.deleteNotificationChannel("botadmin_realtime_service_v2")
        notificationManager.deleteNotificationChannel("botadmin_realtime_messages_v1")
        notificationManager.deleteNotificationChannel("botadmin_realtime_messages_v2")
        notificationManager.deleteNotificationChannel("botadmin_realtime_messages_v3")
        notificationManager.deleteNotificationChannel("botadmin_realtime_messages_v4")
        notificationManager.deleteNotificationChannel("botadmin_realtime_messages_v5")
        val existing = notificationManager.getNotificationChannel(MESSAGE_CHANNEL_ID)
        if (existing != null) return
        val channel = NotificationChannel(
            MESSAGE_CHANNEL_ID,
            "Mensagens do WhatsApp",
            NotificationManager.IMPORTANCE_HIGH
        )
        channel.description = "Notificacoes de conversas e grupos do BotAdmin"
        channel.setShowBadge(true)
        notificationManager.createNotificationChannel(channel)
    }

    private fun updateMessageState(
        context: Context,
        chatKey: String,
        notificationId: String,
        body: String,
        timestamp: Long,
    ): MessageNotificationState? {
        val prefs = context.getSharedPreferences(MESSAGE_PREFS, Context.MODE_PRIVATE)
        val prefix = "chat_${chatKey.hashCode()}"
        val idsKey = "${prefix}_ids"
        val linesKey = "${prefix}_lines"
        val countKey = "${prefix}_count"
        val lastAtKey = "${prefix}_last_at"
        val lastAt = prefs.getLong(lastAtKey, 0L)
        val stale = timestamp - lastAt > STALE_WINDOW_MS || timestamp < lastAt - STALE_WINDOW_MS
        val existingIds = if (stale) {
            emptyList()
        } else {
            prefs.getString(idsKey, "")
                .orEmpty()
                .split(SEPARATOR)
                .filter { it.isNotBlank() }
        }
        if (notificationId.isNotBlank() && existingIds.contains(notificationId)) {
            return null
        }
        val nextIds = (listOf(notificationId).filter { it.isNotBlank() } + existingIds)
            .distinct()
            .take(MAX_RECENT_IDS)
        val existingLines = if (stale) {
            emptyList()
        } else {
            prefs.getString(linesKey, "")
                .orEmpty()
                .split(SEPARATOR)
                .filter { it.isNotBlank() }
        }
        val nextLines = (listOf(body).filter { it.isNotBlank() } + existingLines)
            .take(MAX_RECENT_LINES)
        val nextCount = if (stale) 1 else prefs.getInt(countKey, 0) + 1
        val chatKeys = prefs.getString(MESSAGE_PREFS_CHAT_KEYS, "")
            .orEmpty()
            .split(SEPARATOR)
            .filter { it.isNotBlank() }
            .let { (listOf(chatKey) + it).distinct() }
        prefs.edit()
            .putString(idsKey, nextIds.joinToString(SEPARATOR))
            .putString(linesKey, nextLines.joinToString(SEPARATOR))
            .putInt(countKey, nextCount)
            .putLong(lastAtKey, timestamp)
            .putString(MESSAGE_PREFS_CHAT_KEYS, chatKeys.joinToString(SEPARATOR))
            .apply()
        var totalUnread = 0
        var totalChats = 0
        chatKeys.forEach { key ->
            val keyPrefix = "chat_${key.hashCode()}"
            val keyLastAt = prefs.getLong("${keyPrefix}_last_at", 0L)
            if (keyLastAt > 0L && System.currentTimeMillis() - keyLastAt <= STALE_WINDOW_MS) {
                totalUnread += prefs.getInt("${keyPrefix}_count", 0)
                totalChats++
            }
        }
        return MessageNotificationState(nextCount, nextLines, totalUnread, totalChats)
    }

    private fun stableChatKey(instanceId: String, chatJid: String): String =
        "${instanceId.trim()}:$chatJid"

    private fun loadAvatar(rawUrl: String?): Bitmap? {
        val url = rawUrl?.trim().orEmpty()
        if (!url.startsWith("http://") && !url.startsWith("https://")) return null
        avatarCache[url]?.let { return it }
        return runCatching {
            avatarExecutor.submit<Bitmap?> { downloadAvatar(url) }
                .get(4, TimeUnit.SECONDS)
        }.onFailure { error ->
            android.util.Log.w("BotAdminFirebase", "Avatar download failed: $url", error)
        }.getOrNull()
    }

    private fun downloadAvatar(url: String): Bitmap? {
        return runCatching {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 1800
                readTimeout = 2500
                requestMethod = "GET"
                setRequestProperty("Accept", "image/*")
                setRequestProperty("User-Agent", "BotAdmin/1.0 Android")
            }
            connection.inputStream.use { stream ->
                BitmapFactory.decodeStream(stream)?.also { bitmap ->
                    avatarCache[url] = bitmap
                }
            }
        }.getOrNull()
    }

    private data class MessageNotificationState(
        val count: Int,
        val lines: List<String>,
        val totalUnread: Int,
        val totalChats: Int,
    )
}
