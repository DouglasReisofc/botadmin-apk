package com.botadmin.shop.notifications;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class NotificationAudioService extends Service {
    private static final String TAG = "StoreBotAudioSvc";
    private static final String EXTRA_SOUND_NAME = "storebot_extra_sound_name";
    private static final String EXTRA_SOUND_URL = "storebot_extra_sound_url";
    private static final String EXTRA_SPEAK_TEXT = "storebot_extra_speak_text";
    private static final String EXTRA_SPEAK_LOCALE = "storebot_extra_speak_locale";
    private static final String EXTRA_SPEAK_URL = "storebot_extra_speak_url";
    private static final String EXTRA_SPEECH_VOICE = "storebot_extra_speech_voice";
    private static final String EXTRA_SPEECH_MODE = "storebot_extra_speech_mode";
    private static final int FOREGROUND_NOTIFICATION_ID = 0x5354; // 'ST'

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean FOREGROUND_STARTED = new AtomicBoolean(false);

    public static void enqueue(Context context, NotificationUtils.NotificationAudioPayload payload) {
        if (context == null || payload == null) {
            return;
        }

        Context appContext = context.getApplicationContext();
        Intent intent = new Intent(appContext, NotificationAudioService.class);
        intent.putExtra(EXTRA_SOUND_NAME, payload.soundName);
        intent.putExtra(EXTRA_SOUND_URL, payload.soundUrl);
        intent.putExtra(EXTRA_SPEAK_TEXT, payload.speakText);
        intent.putExtra(EXTRA_SPEAK_LOCALE, payload.speakLocale);
        intent.putExtra(EXTRA_SPEAK_URL, payload.speakUrl);
        intent.putExtra(EXTRA_SPEECH_VOICE, payload.speechVoice);
        intent.putExtra(EXTRA_SPEECH_MODE, payload.speechMode);

        try {
            ContextCompat.startForegroundService(appContext, intent);
        } catch (IllegalStateException exception) {
            Log.w(TAG, "Falha ao iniciar serviço em primeiro plano, executando fallback", exception);
            NotificationUtils.handleNotificationAudio(appContext, payload);
        } catch (Exception exception) {
            Log.e(TAG, "Erro inesperado ao iniciar serviço de áudio", exception);
            NotificationUtils.handleNotificationAudio(appContext, payload);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }

        ensureForegroundNotification();

        final String soundName = normalizeExtra(intent.getStringExtra(EXTRA_SOUND_NAME));
        final String soundUrl = normalizeExtra(intent.getStringExtra(EXTRA_SOUND_URL));
        final String speakText = normalizeExtra(intent.getStringExtra(EXTRA_SPEAK_TEXT));
        final String speakLocale = normalizeExtra(intent.getStringExtra(EXTRA_SPEAK_LOCALE));
        final String speakUrl = normalizeExtra(intent.getStringExtra(EXTRA_SPEAK_URL));
        final String speechVoice = normalizeExtra(intent.getStringExtra(EXTRA_SPEECH_VOICE));
        final String speechMode = normalizeExtra(intent.getStringExtra(EXTRA_SPEECH_MODE));

        final NotificationUtils.NotificationAudioPayload payload = new NotificationUtils.NotificationAudioPayload(
                soundName,
                soundUrl,
                speakText,
                speakLocale,
                speakUrl,
                speechVoice,
                speechMode
        );

        EXECUTOR.execute(() -> {
            try {
                NotificationUtils.playNotificationAudioBlocking(getApplicationContext(), payload);
            } finally {
                stopSelfResult(startId);
            }
        });

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (FOREGROUND_STARTED.getAndSet(false)) {
            stopForeground(true);
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ensureForegroundNotification() {
        if (FOREGROUND_STARTED.get()) {
            return;
        }

        NotificationUtils.ensureAudioServiceChannel(this);
        Notification notification = new NotificationCompat.Builder(this, NotificationUtils.AUDIO_SERVICE_CHANNEL_ID)
                .setSmallIcon(NotificationUtils.resolveSmallIcon(this))
                .setContentTitle("Reproduzindo áudio do StoreBot")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setSilent(true)
                .setOngoing(true)
                .build();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                        FOREGROUND_NOTIFICATION_ID,
                        notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } else {
                startForeground(FOREGROUND_NOTIFICATION_ID, notification);
            }
            FOREGROUND_STARTED.set(true);
        } catch (Exception exception) {
            Log.e(TAG, "Falha ao colocar serviço em primeiro plano", exception);
        }
    }

    private static String normalizeExtra(String value) {
        if (TextUtils.isEmpty(value)) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
