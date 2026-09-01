package com.botadmin.shop.notifications;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.NonNull;
import android.app.ActivityManager;
import android.content.Context;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.botadmin.shop.MainActivity;
import com.botadmin.shop.notifications.NotificationUtils.NotificationAudioPayload;

import java.util.Map;

public class StoreBotFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "StoreBotFcm";
    private static final String KEY_TITLE = "storebot_title";
    private static final String KEY_BODY = "storebot_body";
    private static final String KEY_CHANNEL_ID = "storebot_channel_id";
    private static final String KEY_SOUND = "storebot_sound";
    private static final String KEY_SOUND_URL = "storebot_sound_url";
    private static final String KEY_SPEAK = "storebot_speak";
    private static final String KEY_SPEAK_LOCALE = "storebot_speak_locale";
    private static final String KEY_SPEECH_MODE = "storebot_speech_mode";
    private static final String KEY_SPEAK_URL = "storebot_speak_url";
    private static final String KEY_SPEECH_VOICE = "storebot_speech_voice";
    private static final String KEY_IMAGE_URL = "storebot_image_url";

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) {
            return;
        }

        String title = data.get(KEY_TITLE);
        String body = data.get(KEY_BODY);
        String channelId = data.get(KEY_CHANNEL_ID);
        String soundName = data.get(KEY_SOUND);
        String soundUrl = data.get(KEY_SOUND_URL);
        String speakText = data.get(KEY_SPEAK);
        String speakLocale = data.get(KEY_SPEAK_LOCALE);
        String speechMode = data.get(KEY_SPEECH_MODE);
        String speakUrl = data.get(KEY_SPEAK_URL);
        String speechVoice = data.get(KEY_SPEECH_VOICE);

        String resolvedChannelId = NotificationUtils.resolveChannelId(channelId);
        String normalizedSoundUrl = TextUtils.isEmpty(soundUrl) ? null : soundUrl.trim();
        boolean hasSoundUrl = !TextUtils.isEmpty(normalizedSoundUrl);
        boolean hasSoundName = !TextUtils.isEmpty(soundName);
        boolean hasBundledSound = hasSoundName && NotificationUtils.hasLocalSoundResource(this, soundName);
        boolean shouldUseChannelSound = hasBundledSound;

        // If the app is in foreground and this is a support message (has whatsappId),
        // prefer the in-conversation sound (support-reply) to mimic WhatsApp behavior.
        // This avoids the generic notification tone while conversing.
        if (!TextUtils.isEmpty(data.get("whatsappId")) && isAppInForeground()) {
            soundName = "support-reply"; // normalized to res/raw/support_reply
            normalizedSoundUrl = null; // ignore remote sound when foreground
            shouldUseChannelSound = true;
        }

        NotificationUtils.ensureChannel(this, resolvedChannelId, soundName, shouldUseChannelSound);
        Uri soundUri = shouldUseChannelSound ? NotificationUtils.resolveSoundUri(this, soundName) : null;

        if (!hasBundledSound && hasSoundName) {
            Log.w(TAG, "Som personalizado " + soundName + " não encontrado nos recursos locais. Mantendo reprodução remota.");
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (Map.Entry<String, String> entry : data.entrySet()) {
            intent.putExtra(entry.getKey(), entry.getValue());
        }
        // Compute default target for support if whatsappId is present
        String whatsappId = data.get("whatsappId");
        if (!TextUtils.isEmpty(whatsappId)) {
            intent.putExtra("target_url", "/dashboard/user/conversas");
            intent.putExtra("target_whatsapp_id", whatsappId);
        }

        int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingIntentFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                pendingIntentFlags
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, resolvedChannelId)
                .setSmallIcon(NotificationUtils.resolveSmallIcon(this))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setContentIntent(pendingIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (!TextUtils.isEmpty(title)) {
            builder.setContentTitle(title);
        } else {
            builder.setContentTitle(NotificationUtils.resolveAppName(this));
        }

        if (!TextUtils.isEmpty(body)) {
            builder.setContentText(body);
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        }

        // Optional big image (Android only)
        String imageUrl = data.get(KEY_IMAGE_URL);
        if (!TextUtils.isEmpty(imageUrl)) {
            try {
                java.net.URL url = new java.net.URL(imageUrl);
                java.net.HttpURLConnection connection = (java.net.HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(3500);
                connection.setReadTimeout(3500);
                connection.setInstanceFollowRedirects(true);
                connection.connect();
                java.io.InputStream input = connection.getInputStream();
                android.graphics.Bitmap bitmap = android.graphics.BitmapFactory.decodeStream(input);
                input.close();
                connection.disconnect();
                if (bitmap != null) {
                    builder.setStyle(new NotificationCompat.BigPictureStyle()
                            .bigPicture(bitmap)
                            .setSummaryText(body));
                }
            } catch (Exception e) {
                Log.w(TAG, "Falha ao carregar imagem da notificação: " + e.getMessage());
            }
        }

        if (soundUri != null) {
            builder.setSound(soundUri);
        } else {
            builder.setSound(null);
        }

        // Add quick actions
        PendingIntent actionOpen = PendingIntent.getActivity(
                this,
                1,
                intent,
                pendingIntentFlags
        );
        builder.addAction(android.R.drawable.ic_menu_view, "Abrir conversa", actionOpen);

        // Se for mensagem de suporte e app em foreground, não exibe notificação visual
        // (somente reproduz o áudio curto de reply), senão notifica normalmente.
        boolean isSupportMsg = !TextUtils.isEmpty(data.get("whatsappId"));
        if (!(isSupportMsg && isAppInForeground())) {
            NotificationManagerCompat.from(this).notify(
                    NotificationUtils.nextNotificationId(),
                    builder.build()
            );
        }

        if (TextUtils.isEmpty(speakText)) {
            speakText = body;
        }

        if (!TextUtils.isEmpty(speechMode)) {
            Log.d(TAG, "Reproduzindo TTS remoto (modo=" + speechMode + ")");
        }

        NotificationAudioService.enqueue(
                this,
                new NotificationAudioPayload(
                        hasSoundName ? soundName : null,
                        normalizedSoundUrl,
                        speakText,
                        speakLocale,
                        speakUrl,
                        speechVoice,
                        speechMode
                )
        );
    }

    private boolean isAppInForeground() {
        try {
            ActivityManager activityManager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (activityManager == null) return false;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                for (ActivityManager.AppTask task : activityManager.getAppTasks()) {
                    ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                    if (info != null && info.topActivity != null) {
                        if (getPackageName().equals(info.topActivity.getPackageName())) {
                            return true;
                        }
                    }
                }
                return false;
            } else {
                @SuppressWarnings("deprecation")
                java.util.List<ActivityManager.RunningTaskInfo> tasks = activityManager.getRunningTasks(1);
                if (tasks == null || tasks.isEmpty()) return false;
                ActivityManager.RunningTaskInfo top = tasks.get(0);
                return top.topActivity != null && getPackageName().equals(top.topActivity.getPackageName());
            }
        } catch (Exception ignored) {
            return false;
        }
    }
}
