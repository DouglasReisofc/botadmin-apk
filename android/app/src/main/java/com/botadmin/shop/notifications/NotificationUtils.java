package com.botadmin.shop.notifications;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.text.TextUtils;
import android.util.Log;
import android.util.Base64;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import org.json.JSONArray;
import org.json.JSONObject;

public final class NotificationUtils {
    private static final String TAG = "StoreBotNotification";
    public static final String DEFAULT_CHANNEL_ID = "storebot.realtime";
    public static final String AUDIO_SERVICE_CHANNEL_ID = "storebot.realtime.audio";
    private static final String DEFAULT_CHANNEL_NAME = "StoreBot em tempo real";
    private static final String DEFAULT_CHANNEL_DESCRIPTION = "Alertas enviados pelo StoreBot.";
    private static final String AUDIO_SERVICE_CHANNEL_NAME = "Áudio de notificações do StoreBot";
    private static final String AUDIO_SERVICE_CHANNEL_DESCRIPTION =
            "Mantém a reprodução dos áudios personalizados mesmo com o app fechado.";
    public static final String DEFAULT_SOUND_NAME = "storebot_push_sound";
    private static final AtomicInteger NOTIFICATION_COUNTER = new AtomicInteger(1000);
    private static final ExecutorService SPEECH_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int REMOTE_CONNECT_TIMEOUT_MS = 5_000; // faster failover
    private static final int REMOTE_READ_TIMEOUT_MS = 8_000; // faster failover
    private static final int MAX_REMOTE_AUDIO_BYTES = 10 * 1024 * 1024;
    private static final long PLAYBACK_TIMEOUT_SECONDS = 120;
    private static final String CACHE_DIRECTORY = "notification_audio";
    private static final String TTS_ENDPOINT = "https://ttsvibes.com/?/generate";

    private static final java.util.Map<String, String> TTS_VOICE_MAP = new java.util.HashMap<>();

    static {
        TTS_VOICE_MAP.put("laizza", "tt-pt_female_laizza");
        TTS_VOICE_MAP.put("br004", "tt-br_004");
        TTS_VOICE_MAP.put("lhays", "tt-pt_female_lhays");
        TTS_VOICE_MAP.put("ludmilla", "tt-bp_female_ludmilla");
        TTS_VOICE_MAP.put("bueno", "tt-pt_male_bueno");
        TTS_VOICE_MAP.put("ivete", "tt-bp_female_ivete");
        TTS_VOICE_MAP.put("br003", "tt-br_003");
        TTS_VOICE_MAP.put("br001", "tt-br_001");
        TTS_VOICE_MAP.put("br002", "tt-br_002");
        TTS_VOICE_MAP.put("br005", "tt-br_005");
    }

    public static final class NotificationAudioPayload {
        public final String soundName;
        public final String soundUrl;
        public final String speakText;
        public final String speakLocale;
        public final String speakUrl;
        public final String speechVoice;
        public final String speechMode;

        public NotificationAudioPayload(
                String soundName,
                String soundUrl,
                String speakText,
                String speakLocale,
                String speakUrl,
                String speechVoice,
                String speechMode
        ) {
            this.soundName = soundName;
            this.soundUrl = soundUrl;
            this.speakText = speakText;
            this.speakLocale = speakLocale;
            this.speakUrl = speakUrl;
            this.speechVoice = speechVoice;
            this.speechMode = speechMode;
        }
    }

    private NotificationUtils() {
        // Utility class
    }

    public static int resolveSmallIcon(Context context) {
        int resourceId = context.getResources().getIdentifier("ic_notification", "drawable", context.getPackageName());
        if (resourceId != 0) {
            return resourceId;
        }

        ApplicationInfo applicationInfo = context.getApplicationInfo();
        if (applicationInfo != null && applicationInfo.icon != 0) {
            return applicationInfo.icon;
        }

        return android.R.drawable.ic_dialog_info;
    }

    public static CharSequence resolveAppName(Context context) {
        PackageManager packageManager = context.getPackageManager();
        if (packageManager != null) {
            try {
                ApplicationInfo applicationInfo = context.getApplicationInfo();
                CharSequence label = packageManager.getApplicationLabel(applicationInfo);
                if (!TextUtils.isEmpty(label)) {
                    return label;
                }
            } catch (Exception ignored) {
                // Ignored – fallback below
            }
        }
        return context.getPackageName();
    }

    public static int nextNotificationId() {
        return NOTIFICATION_COUNTER.incrementAndGet();
    }

    private static void shutdownTextToSpeech(TextToSpeech[] reference) {
        TextToSpeech textToSpeech = reference[0];
        if (textToSpeech != null) {
            textToSpeech.shutdown();
            reference[0] = null;
        }
    }

    private static void triggerFallback(Runnable fallback, AtomicBoolean guard) {
        if (fallback == null || guard == null) {
            return;
        }

        if (!guard.compareAndSet(false, true)) {
            return;
        }

        Handler handler = new Handler(Looper.getMainLooper());
        handler.post(() -> {
            try {
                fallback.run();
            } catch (Exception exception) {
                Log.e(TAG, "Falha ao executar fallback de áudio", exception);
            }
        });
    }

    public static String resolveChannelId(String channelId) {
        if (channelId == null) {
            return DEFAULT_CHANNEL_ID;
        }
        final String trimmed = channelId.trim();
        return trimmed.isEmpty() ? DEFAULT_CHANNEL_ID : trimmed;
    }

    private static String normalizeSoundName(String value) {
        if (value == null) {
            return DEFAULT_SOUND_NAME;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        normalized = normalized.replaceAll("[^a-z0-9_]+", "_");
        if (normalized.isEmpty()) {
            return DEFAULT_SOUND_NAME;
        }
        return normalized;
    }

    private static AudioAttributes getNotificationAudioAttributes() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
    }

    private static AudioAttributes getSpeechAudioAttributes() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
    }

    private interface MediaPlayerSource {
        void configure(MediaPlayer player) throws Exception;
    }

    private static boolean playAudioWithPlayer(
            Context context,
            MediaPlayerSource source,
            AudioAttributes audioAttributes,
            int fallbackStream
    ) {
        MediaPlayer player = new MediaPlayer();
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        AudioFocusRequest focusRequest = null;
        PowerManager.WakeLock wakeLock = null;
        final AtomicBoolean started = new AtomicBoolean(false);

        try {
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, TAG + ":AudioPlayback");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(TimeUnit.SECONDS.toMillis(PLAYBACK_TIMEOUT_SECONDS));
            }
        } catch (Exception exception) {
            Log.w(TAG, "Falha ao adquirir wake lock para audio", exception);
        }

        try {
            player.setWakeMode(context.getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
        } catch (Exception exception) {
            Log.w(TAG, "Nao foi possivel configurar wake mode no MediaPlayer", exception);
        }

        try {
            if (audioManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                            .setOnAudioFocusChangeListener(focusChange -> {})
                            .setAudioAttributes(audioAttributes)
                            .build();
                    audioManager.requestAudioFocus(focusRequest);
                } else {
                    audioManager.requestAudioFocus(
                            null,
                            fallbackStream,
                            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
                    );
                }
            }
        } catch (Exception exception) {
            Log.w(TAG, "Falha ao requisitar audio focus", exception);
        }

        final CountDownLatch latch = new CountDownLatch(1);
        player.setOnCompletionListener(mp -> latch.countDown());
        player.setOnErrorListener((mp, what, extra) -> {
            latch.countDown();
            return true;
        });

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                player.setAudioAttributes(audioAttributes);
            } else {
                player.setAudioStreamType(fallbackStream);
            }

            source.configure(player);
            player.prepare();
            player.start();
            started.set(true);
            latch.await(PLAYBACK_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException interruptedException) {
            Thread.currentThread().interrupt();
        } catch (Exception exception) {
            Log.e(TAG, "Falha ao reproduzir audio", exception);
        } finally {
            try {
                player.stop();
            } catch (Exception ignored) {
                // ignore
            }
            player.release();

            if (audioManager != null) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                        audioManager.abandonAudioFocusRequest(focusRequest);
                    } else {
                        audioManager.abandonAudioFocus(null);
                    }
                } catch (Exception exception) {
                    Log.w(TAG, "Falha ao liberar audio focus", exception);
                }
            }

            if (wakeLock != null && wakeLock.isHeld()) {
                try {
                    wakeLock.release();
                } catch (Exception exception) {
                    Log.w(TAG, "Falha ao liberar wake lock", exception);
                }
            }
        }

        return started.get();
    }

    private static boolean playAudioStream(
            Context context,
            String url,
            AudioAttributes audioAttributes,
            int fallbackStream
    ) {
        if (TextUtils.isEmpty(url)) {
            return false;
        }

        try {
            return playAudioWithPlayer(
                    context,
                    player -> player.setDataSource(url),
                    audioAttributes,
                    fallbackStream
            );
        } catch (Exception exception) {
            Log.w(TAG, "Falha ao transmitir audio remoto diretamente", exception);
            return false;
        }
    }

    private static File downloadRemoteAudio(Context context, String url, String prefix) {
        return downloadRemoteAudio(context, url, prefix, 5);
    }

    private static File downloadRemoteAudio(
            Context context,
            String url,
            String prefix,
            int redirectsRemaining
    ) {
        HttpURLConnection connection = null;
        InputStream inputStream = null;
        FileOutputStream outputStream = null;
        File cacheFile = null;
        boolean success = false;

        try {
            URL target = new URL(url);
            connection = (HttpURLConnection) target.openConnection();
            connection.setConnectTimeout(REMOTE_CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(REMOTE_READ_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "audio/mpeg,audio/*;q=0.8,*/*;q=0.5");
            connection.connect();

            final int status = connection.getResponseCode();
            if (status >= HttpURLConnection.HTTP_BAD_REQUEST) {
                Log.w(TAG, "Falha ao baixar audio remoto. Status=" + status);
                return null;
            }

            if (status >= HttpURLConnection.HTTP_MULT_CHOICE && status < HttpURLConnection.HTTP_BAD_REQUEST) {
                final String location = connection.getHeaderField("Location");
                if (!TextUtils.isEmpty(location) && redirectsRemaining > 0) {
                    try {
                        URL redirectUrl = new URL(new URL(url), location);
                        return downloadRemoteAudio(context, redirectUrl.toString(), prefix, redirectsRemaining - 1);
                    } catch (Exception exception) {
                        Log.w(TAG, "Falha ao seguir redirecionamento de audio", exception);
                    }
                }
            }

            inputStream = new BufferedInputStream(connection.getInputStream());

            final String contentType = connection.getContentType();
            if (contentType != null) {
                final String lowerContentType = contentType.toLowerCase(Locale.ROOT);
                if (!lowerContentType.contains("audio")) {
                    Log.w(TAG, "Conteudo remoto nao parece ser audio. Content-Type=" + contentType);
                    return null;
                }
            }
            File directory = new File(context.getCacheDir(), CACHE_DIRECTORY);
            if (!directory.exists() && !directory.mkdirs()) {
                Log.w(TAG, "Nao foi possivel criar diretorio de cache para audio");
                return null;
            }

            cacheFile = File.createTempFile(prefix, ".mp3", directory);
            outputStream = new FileOutputStream(cacheFile);

            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            boolean tooLarge = false;
            while ((read = inputStream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_REMOTE_AUDIO_BYTES) {
                    tooLarge = true;
                    break;
                }
                outputStream.write(buffer, 0, read);
            }

            outputStream.flush();

            if (tooLarge) {
                Log.w(TAG, "Arquivo de audio remoto excede limite permitido: " + url);
            } else if (total <= 0) {
                Log.w(TAG, "Arquivo de audio remoto vazio: " + url);
            } else {
                success = true;
            }
        } catch (Exception exception) {
            Log.e(TAG, "Erro ao baixar audio remoto", exception);
        } finally {
            if (outputStream != null) {
                try {
                    outputStream.close();
                } catch (IOException ignored) {
                }
            }
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (IOException ignored) {
                }
            }
            if (connection != null) {
                connection.disconnect();
            }

            if (!success && cacheFile != null && cacheFile.exists()) {
                if (!cacheFile.delete()) {
                    Log.w(TAG, "Falha ao remover cache de audio temporario");
                }
            }
        }

        return success ? cacheFile : null;
    }

    private static File generateTtsFileFromService(Context context, String voiceId, String text) {
        if (context == null || TextUtils.isEmpty(text) || TextUtils.isEmpty(voiceId)) {
            return null;
        }

        final String voiceCode = TTS_VOICE_MAP.get(voiceId.toLowerCase(Locale.ROOT));
        if (voiceCode == null) {
            Log.w(TAG, "Voz TTS não mapeada: " + voiceId);
            return null;
        }

        HttpURLConnection connection = null;
        FileOutputStream outputStream = null;
        File cacheFile = null;

        try {
            URL target = new URL(TTS_ENDPOINT);
            connection = (HttpURLConnection) target.openConnection();
            connection.setConnectTimeout(REMOTE_CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(REMOTE_READ_TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Origin", "https://ttsvibes.com");
            connection.setRequestProperty("Referer", "https://ttsvibes.com/");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Android StoreBot)");
            connection.setRequestProperty("Accept", "application/json");

            final String boundary = "----StoreBotTTS" + System.currentTimeMillis();
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

            StringBuilder bodyBuilder = new StringBuilder();
            bodyBuilder.append("--").append(boundary).append("\r\n");
            bodyBuilder.append("Content-Disposition: form-data; name=\"selectedVoiceValue\"\r\n\r\n");
            bodyBuilder.append(voiceCode).append("\r\n");
            bodyBuilder.append("--").append(boundary).append("\r\n");
            bodyBuilder.append("Content-Disposition: form-data; name=\"text\"\r\n\r\n");
            bodyBuilder.append(text).append("\r\n");
            bodyBuilder.append("--").append(boundary).append("--\r\n");

            connection.getOutputStream().write(bodyBuilder.toString().getBytes("UTF-8"));
            connection.getOutputStream().flush();

            int status = connection.getResponseCode();
            if (status >= HttpURLConnection.HTTP_BAD_REQUEST) {
                Log.w(TAG, "Serviço TTS retornou status " + status);
                return null;
            }

            InputStream input = new BufferedInputStream(connection.getInputStream());
            String response = readStreamToString(input);
            input.close();

            JSONObject json = new JSONObject(response);
            String raw = json.optString("data", null);
            if (raw == null) {
                Log.w(TAG, "Resposta TTS sem campo data");
                return null;
            }

            JSONArray array = new JSONArray(raw);
            String base64 = null;
            if (array.length() > 2 && array.opt(2) instanceof String) {
                base64 = array.optString(2, null);
            }
            if (TextUtils.isEmpty(base64)) {
                Log.w(TAG, "Resposta TTS sem base64 válido");
                return null;
            }

            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            if (bytes == null || bytes.length == 0) {
                Log.w(TAG, "Bytes TTS vazios");
                return null;
            }

            File directory = new File(context.getCacheDir(), CACHE_DIRECTORY);
            if (!directory.exists() && !directory.mkdirs()) {
                return null;
            }
            cacheFile = File.createTempFile("tts_", ".mp3", directory);
            outputStream = new FileOutputStream(cacheFile);
            outputStream.write(bytes);
            outputStream.flush();

            return cacheFile;
        } catch (Exception exception) {
            Log.e(TAG, "Falha ao gerar TTS via serviço", exception);
            if (cacheFile != null && cacheFile.exists()) {
                //noinspection ResultOfMethodCallIgnored
                cacheFile.delete();
            }
            return null;
        } finally {
            if (outputStream != null) {
                try { outputStream.close(); } catch (IOException ignored) {}
            }
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readStreamToString(InputStream stream) throws IOException {
        StringBuilder sb = new StringBuilder();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = stream.read(buffer)) != -1) {
            sb.append(new String(buffer, 0, read, "UTF-8"));
        }
        return sb.toString();
    }

    private static boolean playAudioFile(
            Context context,
            File file,
            AudioAttributes audioAttributes,
            int fallbackStream
    ) {
        if (file == null || !file.exists()) {
            return false;
        }

        return playAudioWithPlayer(context, player -> {
            try (FileInputStream inputStream = new FileInputStream(file)) {
                player.setDataSource(inputStream.getFD());
            }
        }, audioAttributes, fallbackStream);
    }

    private static boolean playAudioFromUrlBlocking(
            Context context,
            String url,
            String prefix,
            AudioAttributes audioAttributes,
            int fallbackStream
    ) {
        if (playAudioStream(context, url, audioAttributes, fallbackStream)) {
            return true;
        }

        File file = downloadRemoteAudio(context, url, prefix);
        if (file == null) {
            return false;
        }

        try {
            return playAudioFile(context, file, audioAttributes, fallbackStream);
        } finally {
            if (!file.delete()) {
                Log.w(TAG, "Falha ao limpar cache de audio: " + file.getAbsolutePath());
            }
        }
    }

    private static int resolveSoundResourceId(Context context, String soundName) {
        if (context == null) {
            return 0;
        }

        String normalized = normalizeSoundName(soundName);
        if (TextUtils.isEmpty(normalized)) {
            normalized = DEFAULT_SOUND_NAME;
        }

        int resourceId = context.getResources().getIdentifier(normalized, "raw", context.getPackageName());
        if (resourceId == 0 && !DEFAULT_SOUND_NAME.equals(normalized)) {
            resourceId = context.getResources().getIdentifier(DEFAULT_SOUND_NAME, "raw", context.getPackageName());
        }

        if (resourceId == 0) {
            Log.w(TAG, "Arquivo de áudio não encontrado para notificação: " + normalized);
        }

        return resourceId;
    }

    public static Uri resolveSoundUri(Context context, String soundName) {
        int resourceId = resolveSoundResourceId(context, soundName);
        if (resourceId == 0) {
            return null;
        }
        return Uri.parse("android.resource://" + context.getPackageName() + "/" + resourceId);
    }

    public static boolean hasLocalSoundResource(Context context, String soundName) {
        return resolveSoundResourceId(context, soundName) != 0;
    }

    private static boolean playLocalSoundResource(Context context, String soundName) {
        int resourceId = resolveSoundResourceId(context, soundName);
        if (resourceId == 0) {
            return false;
        }

        AssetFileDescriptor descriptor = null;
        try {
            descriptor = context.getResources().openRawResourceFd(resourceId);
            if (descriptor == null) {
                return false;
            }

            AssetFileDescriptor finalDescriptor = descriptor;
            return playAudioWithPlayer(
                    context,
                    player -> player.setDataSource(
                            finalDescriptor.getFileDescriptor(),
                            finalDescriptor.getStartOffset(),
                            finalDescriptor.getLength()
                    ),
                    getNotificationAudioAttributes(),
                    AudioManager.STREAM_NOTIFICATION
            );
        } catch (Exception exception) {
            Log.e(TAG, "Falha ao reproduzir som local", exception);
            return false;
        } finally {
            if (descriptor != null) {
                try {
                    descriptor.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private static boolean playNotificationSoundInternal(Context context, String soundName, String soundUrl) {
        boolean played = false;

        if (!TextUtils.isEmpty(soundUrl)) {
            played = playAudioFromUrlBlocking(
                    context,
                    soundUrl,
                    "sound_",
                    getNotificationAudioAttributes(),
                    AudioManager.STREAM_NOTIFICATION
            );
        }

        if (!played && !TextUtils.isEmpty(soundName)) {
            played = playLocalSoundResource(context, soundName);
        }

        return played;
    }

    private static boolean playSpeechFromUrlInternal(Context context, String url) {
        if (TextUtils.isEmpty(url)) {
            return false;
        }

        return playAudioFromUrlBlocking(
                context,
                url,
                "speech_",
                getSpeechAudioAttributes(),
                AudioManager.STREAM_MUSIC
        );
    }

    private static boolean playNotificationAudioInternal(Context context, NotificationAudioPayload payload) {
        if (context == null || payload == null) {
            return false;
        }

        final String soundName = payload.soundName;
        final String soundUrl = payload.soundUrl != null ? payload.soundUrl.trim() : null;
        final String speakText = payload.speakText;
        final String speakLocale = payload.speakLocale;
        final String speakUrl = payload.speakUrl != null ? payload.speakUrl.trim() : null;
        final String speechMode = payload.speechMode;

        boolean played = false;

        try {
            played = playNotificationSoundInternal(context, soundName, soundUrl);
        } catch (Exception exception) {
            Log.e(TAG, "Falha ao reproduzir som da notificacao", exception);
        }

        boolean urlProvided = !TextUtils.isEmpty(speakUrl);
        boolean playedUrl = false;
        // Usar apenas o endpoint (URL) quando disponível; não gerar localmente
        if (urlProvided) {
            try {
                playedUrl = playSpeechFromUrlInternal(context, speakUrl);
                played = played || playedUrl;
            } catch (Exception exception) {
                Log.e(TAG, "Falha ao reproduzir TTS via endpoint", exception);
            }
        }

        boolean allowSystemFallback = (speechMode == null)
                || "browser".equalsIgnoreCase(speechMode);

        if (allowSystemFallback && !played && !TextUtils.isEmpty(speakText)) {
            boolean speechSuccess = speakBlocking(context, speakText, speakLocale);
            played = played || speechSuccess;
        }

        return played;
    }


    public static boolean playNotificationAudioBlocking(Context context, NotificationAudioPayload payload) {
        if (context == null || payload == null) {
            return false;
        }

        final Context appContext = context.getApplicationContext();

        try {
            return playNotificationAudioInternal(appContext, payload);
        } catch (Exception exception) {
            Log.e(TAG, "Falha ao executar rotina de audio da notificacao", exception);
            return false;
        }
    }

    public static void handleNotificationAudio(Context context, NotificationAudioPayload payload) {
        if (context == null || payload == null) {
            return;
        }

        final Context appContext = context.getApplicationContext();

        try {
            SPEECH_EXECUTOR.execute(() -> playNotificationAudioBlocking(appContext, payload));
        } catch (Exception exception) {
            Log.e(TAG, "Erro ao agendar rotina de audio da notificacao", exception);
        }
    }

    public static boolean speakFromUrl(final Context context, final String url, final Runnable onFailure) {
        if (context == null || TextUtils.isEmpty(url)) {
            return false;
        }

        final String trimmedUrl = url.trim();
        if (trimmedUrl.isEmpty()) {
            return false;
        }

        final Context appContext = context.getApplicationContext();
        final AtomicBoolean fallbackGuard = new AtomicBoolean(false);

        try {
            SPEECH_EXECUTOR.execute(() -> {
                boolean success = playSpeechFromUrlInternal(appContext, trimmedUrl);
                if (!success) {
                    triggerFallback(onFailure, fallbackGuard);
                }
            });
            return true;
        } catch (Exception exception) {
            Log.e(TAG, "Erro ao enfileirar reprodução de áudio remoto", exception);
            triggerFallback(onFailure, fallbackGuard);
            return false;
        }
    }

    public static void ensureChannel(Context context, String channelId, String soundName) {
        ensureChannel(context, channelId, soundName, true);
    }

    public static void ensureChannel(Context context, String channelId, String soundName, boolean useChannelSound) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        String resolvedChannelId = resolveChannelId(channelId);
        Uri soundUri = useChannelSound ? resolveSoundUri(context, soundName) : null;
        NotificationChannel existing = manager.getNotificationChannel(resolvedChannelId);
        if (existing != null) {
            Uri existingSound = existing.getSound();
            boolean existingSilent = existingSound == null;

            if (!useChannelSound && existingSilent) {
                return;
            }

            if (useChannelSound) {
                if (soundUri == null && existingSilent) {
                    return;
                }
                if (soundUri != null && soundUri.equals(existingSound)) {
                    return;
                }
            }

            try {
                manager.deleteNotificationChannel(resolvedChannelId);
            } catch (Exception exception) {
                Log.w(TAG, "Falha ao recriar canal de notificacao", exception);
                return;
            }
        }

        NotificationChannel channel = new NotificationChannel(
                resolvedChannelId,
                DEFAULT_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(DEFAULT_CHANNEL_DESCRIPTION);
        channel.enableLights(true);
        channel.enableVibration(true);

        if (useChannelSound && soundUri != null) {
            channel.setSound(soundUri, getNotificationAudioAttributes());
        } else {
            channel.setSound(null, null);
        }

        manager.createNotificationChannel(channel);
    }

    public static void ensureAudioServiceChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }

        NotificationChannel existing = manager.getNotificationChannel(AUDIO_SERVICE_CHANNEL_ID);
        if (existing != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                AUDIO_SERVICE_CHANNEL_ID,
                AUDIO_SERVICE_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(AUDIO_SERVICE_CHANNEL_DESCRIPTION);
        channel.enableLights(false);
        channel.enableVibration(false);
        channel.setSound(null, null);

        manager.createNotificationChannel(channel);
    }

    public static void playRemoteSound(final Context context, final String url) {
        if (context == null || TextUtils.isEmpty(url)) {
            return;
        }

        handleNotificationAudio(context, new NotificationAudioPayload(null, url.trim(), null, null, null, null, null));
    }

    private static Locale resolveLocale(String localeTag) {
        if (TextUtils.isEmpty(localeTag)) {
            return Locale.getDefault();
        }
        try {
            Locale locale = Locale.forLanguageTag(localeTag);
            if (locale != null && !TextUtils.isEmpty(locale.getLanguage())) {
                return locale;
            }
        } catch (Exception exception) {
            Log.w(TAG, "Falha ao interpretar locale do TTS", exception);
        }
        return Locale.getDefault();
    }

    public static void speak(final Context context, final String text, final String localeTag) {
        if (TextUtils.isEmpty(text)) {
            return;
        }

        speakBlocking(context, text, localeTag);
    }

    private static boolean speakBlocking(final Context context, final String text, final String localeTag) {
        if (TextUtils.isEmpty(text) || context == null) {
            return false;
        }

        final Context appContext = context.getApplicationContext();
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicBoolean success = new AtomicBoolean(false);

        Handler handler = new Handler(Looper.getMainLooper());
        handler.post(() -> {
            final TextToSpeech[] textToSpeechRef = new TextToSpeech[1];
            textToSpeechRef[0] = new TextToSpeech(appContext, status -> {
                final TextToSpeech textToSpeech = textToSpeechRef[0];
                if (textToSpeech == null) {
                    latch.countDown();
                    return;
                }

                if (status != TextToSpeech.SUCCESS) {
                    Log.w(TAG, "Falha ao inicializar TextToSpeech. Status: " + status);
                    shutdownTextToSpeech(textToSpeechRef);
                    latch.countDown();
                    return;
                }

                Locale locale = resolveLocale(localeTag);
                if (locale != null) {
                    int availability = textToSpeech.isLanguageAvailable(locale);
                    if (availability >= TextToSpeech.LANG_AVAILABLE) {
                        textToSpeech.setLanguage(locale);
                    }
                }

                final String utteranceId = "storebot_" + System.currentTimeMillis();
                textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String s) {
                        success.set(true);
                    }

                    @Override
                    public void onDone(String s) {
                        shutdownTextToSpeech(textToSpeechRef);
                        latch.countDown();
                    }

                    @Override
                    public void onError(String s) {
                        shutdownTextToSpeech(textToSpeechRef);
                        latch.countDown();
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        shutdownTextToSpeech(textToSpeechRef);
                        latch.countDown();
                    }
                });

                try {
                    int result = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
                    if (result < 0) {
                        Log.w(TAG, "TextToSpeech retornou erro: " + result);
                        shutdownTextToSpeech(textToSpeechRef);
                        latch.countDown();
                    }
                } catch (Exception exception) {
                    Log.e(TAG, "Falha ao reproduzir TTS", exception);
                    shutdownTextToSpeech(textToSpeechRef);
                    latch.countDown();
                }
            });
        });

        try {
            latch.await(PLAYBACK_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException interruptedException) {
            Thread.currentThread().interrupt();
        }

        return success.get();
    }
}
