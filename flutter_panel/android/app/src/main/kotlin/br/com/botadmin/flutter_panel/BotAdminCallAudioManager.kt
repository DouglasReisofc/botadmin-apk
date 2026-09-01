package br.com.botadmin.flutter_panel

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.net.Uri
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.MethodChannel
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Native 16 kHz PCM bridge for calls in the Flutter APK. */
object BotAdminCallAudioManager {
    private const val RequestCode = 7312
    private const val SampleRate = 16_000
    private const val ChannelMask = AudioFormat.CHANNEL_IN_MONO
    private const val OutputMask = AudioFormat.CHANNEL_OUT_MONO
    private const val Encoding = AudioFormat.ENCODING_PCM_16BIT

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "botadmin-call-io").apply { isDaemon = true }
    }
    private val http = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .writeTimeout(12, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private var activity: Activity? = null
    private var pendingArgs: Map<*, *>? = null
    private var pendingResult: MethodChannel.Result? = null
    private var socket: WebSocket? = null
    private var record: AudioRecord? = null
    private var track: AudioTrack? = null
    private var active = AtomicBoolean(false)
    private var speakerphone = false
    private var microphoneMuted = false
    private var sentFrames = AtomicInteger(0)
    private var receivedFrames = AtomicInteger(0)
    private var currentCallId: String? = null
    private val playbackQueue = LinkedBlockingQueue<ByteArray>(32)
    private var playbackRunning = AtomicBoolean(false)

    fun start(context: Context, args: Map<*, *>, result: MethodChannel.Result) {
        val host = context as? Activity
        activity = host
        if (host != null && host.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingArgs = args
            pendingResult = result
            host.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), RequestCode)
            return
        }
        startInternal(context, args, result)
    }

    fun onRequestPermissionsResult(
        requestCode: Int,
        grantResults: IntArray,
    ): Boolean {
        if (requestCode != RequestCode) return false
        val args = pendingArgs
        val result = pendingResult
        pendingArgs = null
        pendingResult = null
        if (grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED || args == null || result == null) {
            result?.error("MICROPHONE_PERMISSION", "Permissao do microfone necessaria para a chamada.", null)
            return true
        }
        startInternal(activity ?: return true, args, result)
        return true
    }

    fun stop(): Map<String, Any?> {
        val callId = currentCallId
        releaseAudio()
        return snapshot(callId = callId)
    }

    fun setSpeakerphone(enabled: Boolean): Map<String, Any?> {
        speakerphone = enabled
        val manager = activity?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        manager?.mode = AudioManager.MODE_IN_COMMUNICATION
        manager?.isSpeakerphoneOn = enabled
        return snapshot()
    }

    fun setMicrophoneMuted(muted: Boolean): Map<String, Any?> {
        microphoneMuted = muted
        return snapshot()
    }

    fun current(): Map<String, Any?> = snapshot()

    private fun startInternal(context: Context, args: Map<*, *>, result: MethodChannel.Result) {
        val baseUrl = args["baseUrl"]?.toString()?.trim().orEmpty()
        val cookie = args["cookie"]?.toString()?.trim().orEmpty()
        val instanceId = args["instanceId"]?.toString()?.toIntOrNull() ?: 0
        val callId = args["callId"]?.toString()?.trim().orEmpty()
        if (baseUrl.isBlank() || cookie.isBlank() || instanceId <= 0 || callId.isBlank()) {
            result.error("INVALID_CALL", "Dados da chamada incompletos.", null)
            return
        }

        releaseAudio()
        currentCallId = callId
        sentFrames.set(0)
        receivedFrames.set(0)
        active.set(false)

        val wsBase = when {
            baseUrl.startsWith("https://") -> "wss://${baseUrl.removePrefix("https://")}" 
            baseUrl.startsWith("http://") -> "ws://${baseUrl.removePrefix("http://")}" 
            else -> baseUrl
        }.trimEnd('/')
        val wsUrl = Uri.parse("$wsBase/ws/whatsapp-call-media")
            .buildUpon()
            .appendQueryParameter("instanceId", instanceId.toString())
            .appendQueryParameter("callId", callId)
            .build()
            .toString()

        val request = Request.Builder()
            .url(wsUrl)
            .header("Cookie", cookie)
            .header("Accept", "application/json")
            .build()

        val timeout = Runnable {
            if (!active.get() && currentCallId == callId) {
                releaseAudio()
                result.error("AUDIO_TIMEOUT", "Tempo esgotado ao conectar o audio da chamada.", null)
            }
        }
        main.postDelayed(timeout, 12_000)

        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (currentCallId != callId) return
                try {
                    openAudio(context)
                    active.set(true)
                    main.removeCallbacks(timeout)
                    result.success(snapshot())
                } catch (error: Throwable) {
                    main.removeCallbacks(timeout)
                    releaseAudio()
                    result.error("AUDIO_OPEN_FAILED", error.message, null)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                // hello/ready/control messages are handled by the bridge server.
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (!active.get()) return
                val data = bytes.toByteArray()
                if (data.isEmpty()) return
                playbackQueue.offer(data)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                main.removeCallbacks(timeout)
                if (currentCallId != callId) return
                val wasActive = active.get()
                releaseAudio()
                if (!wasActive) result.error("AUDIO_SOCKET_FAILED", t.message, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (currentCallId == callId) releaseAudio()
            }
        })
    }

    private fun openAudio(context: Context) {
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        manager.isSpeakerphoneOn = speakerphone

        val recordBuffer = AudioRecord.getMinBufferSize(SampleRate, ChannelMask, Encoding)
            .coerceAtLeast(SampleRate / 2)
        val trackBuffer = AudioTrack.getMinBufferSize(SampleRate, OutputMask, Encoding)
            .coerceAtLeast(SampleRate / 2)
        record = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SampleRate,
            ChannelMask,
            Encoding,
            recordBuffer * 2,
        )
        track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(SampleRate)
                    .setEncoding(Encoding)
                    .setChannelMask(OutputMask)
                    .build(),
            )
            .setBufferSizeInBytes(trackBuffer * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        record?.startRecording()
        track?.play()
        startPlaybackWriter()
        val input = record ?: error("Microfone nao inicializado.")
        io.execute {
            val buffer = ByteArray(640)
            while (active.get() && currentCallId != null) {
                val count = input.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
                val target = socket
                if (count > 0 && target != null && active.get()) {
                    val payload = buffer.copyOfRange(0, count)
                    if (microphoneMuted) payload.fill(0)
                    target.send(ByteString.of(*payload))
                    sentFrames.incrementAndGet()
                }
            }
        }
    }

    private fun startPlaybackWriter() {
        playbackQueue.clear()
        playbackRunning.set(true)
        io.execute {
            while (playbackRunning.get()) {
                val data = playbackQueue.poll(250, TimeUnit.MILLISECONDS) ?: continue
                val output = track ?: continue
                runCatching {
                    output.write(data, 0, data.size, AudioTrack.WRITE_BLOCKING)
                    receivedFrames.incrementAndGet()
                }
            }
        }
    }

    private fun releaseAudio() {
        active.set(false)
        playbackRunning.set(false)
        playbackQueue.clear()
        runCatching { socket?.close(1000, "call audio stopped") }
        socket = null
        runCatching { record?.stop() }
        runCatching { record?.release() }
        record = null
        runCatching { track?.pause() }
        runCatching { track?.flush() }
        runCatching { track?.release() }
        track = null
        activity?.let { context ->
            val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            manager?.isSpeakerphoneOn = false
            manager?.mode = AudioManager.MODE_NORMAL
        }
        currentCallId = null
    }

    private fun snapshot(callId: String? = currentCallId): Map<String, Any?> = mapOf(
        "status" to if (active.get()) "connected" else "idle",
        "callId" to callId,
        "sentFrames" to sentFrames.get(),
        "receivedFrames" to receivedFrames.get(),
        "speakerphone" to speakerphone,
        "microphoneMuted" to microphoneMuted,
    )
}
