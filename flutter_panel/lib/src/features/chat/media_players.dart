import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:just_audio/just_audio.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../../core/api_client.dart';
import '../../core/app_config.dart';
import 'media_blob.dart';
import 'media_local_file.dart';
import 'video_controller_factory.dart';

String resolvePlaybackUrl(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) return trimmed;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  final configuredBase = Uri.tryParse(AppConfig.apiBaseUrl.trim());
  final networkScheme = kIsWeb
      ? (Uri.base.scheme.isEmpty ? 'https' : Uri.base.scheme)
      : (configuredBase?.scheme == 'http' || configuredBase?.scheme == 'https'
            ? configuredBase!.scheme
            : 'https');
  if (trimmed.startsWith('//')) return '$networkScheme:$trimmed';
  final uri = Uri.tryParse(trimmed);
  if (uri != null && uri.hasScheme) return trimmed;
  final normalized = trimmed.startsWith('/') ? trimmed : '/$trimmed';
  // Uri.base is a `file://` URI on Android/iOS.  Resolving an API path
  // against it produces a local file path and just_audio cannot play it. Use
  // the configured panel origin for every relative media URL instead.
  final base = configuredBase;
  if (base != null && (base.scheme == 'http' || base.scheme == 'https')) {
    return base.resolve(normalized).toString();
  }
  return Uri.parse('$networkScheme://botadmin.shop$normalized').toString();
}

bool _isAuthenticatedMediaEndpoint(String url) {
  final value = url.toLowerCase();
  final trimmed = url.trim();
  // Besides the recoverable WhatsApp endpoint, play-command media and other
  // panel-owned `/api/*` routes require the same session cookie.  Treating
  // those as public URLs used to make native builds resolve them to a
  // `file://` URI or receive an unauthenticated 401.
  if (trimmed.startsWith('/api/') || trimmed.startsWith('api/')) return true;
  return (value.contains('/whatsapp-conversations/') &&
          value.contains('/media')) ||
      (value.contains('/internal-groups/') && value.contains('/media/'));
}

/// Resolves a URL that video/audio elements can play (blob on web when auth needed).
Future<_PlayableSource> _resolvePlayableSource(
  WidgetRef ref,
  String rawUrl, {
  String? preferredMime,
  bool forceRefresh = false,
}) async {
  final absolute = resolvePlaybackUrl(rawUrl);
  if (absolute.startsWith('blob:') || absolute.startsWith('data:')) {
    return _PlayableSource(
      url: absolute,
      mimeType: preferredMime,
      isBlob: false,
    );
  }

  final needsAuthFetch =
      kIsWeb ||
      _isAuthenticatedMediaEndpoint(rawUrl) ||
      _isAuthenticatedMediaEndpoint(absolute);
  final cookie = await ref.read(apiClientProvider).readSessionCookieHeader();

  if (!needsAuthFetch) {
    return _PlayableSource(
      url: absolute,
      mimeType: preferredMime,
      headers: cookie == null || cookie.isEmpty ? null : {'Cookie': cookie},
      isBlob: false,
    );
  }

  // Always fetch via Dio (session Cookie header). Web uses blob URLs; native
  // Android/iOS plays a local temporary file, which avoids Cookie/header issues
  // in platform media decoders.
  try {
    final media = await ref
        .read(apiClientProvider)
        .downloadMediaBytes(rawUrl, forceRefresh: forceRefresh);
    final mime = _resolveMime(media.mimeType, preferredMime, rawUrl);

    if (kIsWeb) {
      final blobUrl = createMediaBlobUrl(media.bytes, mime);
      if (blobUrl != null && blobUrl.isNotEmpty) {
        return _PlayableSource(url: blobUrl, mimeType: mime, isBlob: true);
      }
    }

    final localPath = await createLocalMediaFile(media.bytes, mime, rawUrl);
    if (localPath != null && localPath.isNotEmpty) {
      return _PlayableSource(url: localPath, mimeType: mime, isLocalFile: true);
    }

    return _PlayableSource(
      url: absolute,
      mimeType: mime,
      headers: cookie == null || cookie.isEmpty ? null : {'Cookie': cookie},
      isBlob: false,
    );
  } catch (_) {
    // Fallback: try direct URL (may work if browser already has session cookie).
    return _PlayableSource(
      url: absolute,
      mimeType: preferredMime,
      headers: cookie == null || cookie.isEmpty ? null : {'Cookie': cookie},
      isBlob: false,
    );
  }
}

String _resolveMime(String actualMime, String? preferredMime, String rawUrl) {
  final actual = actualMime.trim().toLowerCase();
  final preferred = preferredMime?.trim();
  final preferredLower = preferred?.toLowerCase();
  if (preferredLower != null &&
      preferredLower.startsWith('audio/') &&
      actual == 'video/mp4') {
    return 'audio/mp4';
  }
  if (actual.isNotEmpty && actual != 'application/octet-stream') {
    return actualMime;
  }
  if (preferred != null && preferred.isNotEmpty) return preferred;
  final lower = rawUrl.toLowerCase();
  if (lower.contains('.mp4') || lower.contains('video')) return 'video/mp4';
  if (lower.contains('.webm')) return 'video/webm';
  if (lower.contains('.mp3')) return 'audio/mpeg';
  if (lower.contains('.m4a')) return 'audio/mp4';
  if (lower.contains('.ogg') ||
      lower.contains('opus') ||
      lower.contains('audio')) {
    return 'audio/ogg';
  }
  return actualMime.isEmpty ? 'application/octet-stream' : actualMime;
}

class _PlayableSource {
  const _PlayableSource({
    required this.url,
    this.mimeType,
    this.headers,
    this.isBlob = false,
    this.isLocalFile = false,
  });

  final String url;
  final String? mimeType;
  final Map<String, String>? headers;
  final bool isBlob;
  final bool isLocalFile;
}

class InlineVideoPlayer extends ConsumerStatefulWidget {
  const InlineVideoPlayer({
    super.key,
    required this.url,
    this.width = 300,
    this.height = 170,
    this.borderRadius = const BorderRadius.all(Radius.circular(8)),
    this.title,
    this.mimeType,
    this.autoplay = false,
    this.autoplayLoopMuted = false,
  });

  final String url;
  final double width;
  final double height;
  final BorderRadius borderRadius;
  final String? title;
  final String? mimeType;
  final bool autoplay;
  final bool autoplayLoopMuted;

  @override
  ConsumerState<InlineVideoPlayer> createState() => _InlineVideoPlayerState();
}

class _InlineVideoPlayerState extends ConsumerState<InlineVideoPlayer>
    with AutomaticKeepAliveClientMixin {
  VideoPlayerController? _controller;
  Future<void>? _initializeFuture;
  String? _error;
  bool _showControls = true;
  bool _muted = false;
  String? _blobUrl;
  String? _localFilePath;
  int _loadToken = 0;

  @override
  bool get wantKeepAlive => _controller?.value.isPlaying == true;

  @override
  void initState() {
    super.initState();
    if (widget.autoplayLoopMuted) {
      _showControls = false;
      _muted = true;
    }
    _load();
  }

  @override
  void didUpdateWidget(covariant InlineVideoPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url || oldWidget.mimeType != widget.mimeType) {
      _load();
    }
    if (!oldWidget.autoplay && widget.autoplay) {
      final controller = _controller;
      if (controller != null && controller.value.isInitialized) {
        unawaited(controller.play());
      }
    }
    if (oldWidget.autoplayLoopMuted != widget.autoplayLoopMuted) {
      _showControls = !widget.autoplayLoopMuted;
      _muted = widget.autoplayLoopMuted;
      final controller = _controller;
      if (controller != null) {
        unawaited(controller.setLooping(widget.autoplayLoopMuted));
        unawaited(controller.setVolume(_muted ? 0 : 1));
        if (widget.autoplayLoopMuted) {
          unawaited(controller.play());
        }
      }
    }
  }

  @override
  void dispose() {
    _controller?.removeListener(_onTick);
    _controller?.dispose();
    revokeMediaBlobUrl(_blobUrl);
    unawaited(deleteLocalMediaFile(_localFilePath));
    super.dispose();
  }

  Future<void> _load() async {
    final token = ++_loadToken;
    final previous = _controller;
    previous?.removeListener(_onTick);
    await previous?.dispose();
    final previousBlob = _blobUrl;
    final previousLocalFile = _localFilePath;
    _blobUrl = null;
    _localFilePath = null;
    revokeMediaBlobUrl(previousBlob);
    unawaited(deleteLocalMediaFile(previousLocalFile));

    if (!mounted || token != _loadToken) return;
    setState(() {
      _error = null;
      _showControls = true;
      _controller = null;
      _initializeFuture = _initialize(token);
    });
  }

  Future<void> _initialize(int token) async {
    try {
      var source = await _resolvePlayableSource(
        ref,
        widget.url,
        preferredMime: widget.mimeType ?? 'video/mp4',
      );
      if (!mounted || token != _loadToken) {
        if (source.isBlob) revokeMediaBlobUrl(source.url);
        return;
      }
      var controller = createVideoController(
        url: source.url,
        headers: source.headers,
        isLocalFile: source.isLocalFile,
      );
      _blobUrl = source.isBlob ? source.url : null;
      _localFilePath = source.isLocalFile ? source.url : null;
      _controller = controller;
      controller.addListener(_onTick);
      try {
        await controller.initialize();
      } catch (_) {
        controller.removeListener(_onTick);
        await controller.dispose();
        if (source.isBlob) revokeMediaBlobUrl(source.url);
        if (source.isLocalFile) unawaited(deleteLocalMediaFile(source.url));
        source = await _resolvePlayableSource(
          ref,
          widget.url,
          preferredMime: widget.mimeType ?? 'video/mp4',
          forceRefresh: true,
        );
        if (!mounted || token != _loadToken) {
          if (source.isBlob) revokeMediaBlobUrl(source.url);
          if (source.isLocalFile) unawaited(deleteLocalMediaFile(source.url));
          return;
        }
        controller = createVideoController(
          url: source.url,
          headers: source.headers,
          isLocalFile: source.isLocalFile,
        );
        _blobUrl = source.isBlob ? source.url : null;
        _localFilePath = source.isLocalFile ? source.url : null;
        _controller = controller;
        controller.addListener(_onTick);
        await controller.initialize();
      }
      await controller.setLooping(widget.autoplayLoopMuted);
      await controller.setVolume(widget.autoplayLoopMuted || _muted ? 0 : 1);
      if (widget.autoplay || widget.autoplayLoopMuted) {
        try {
          await controller.play();
        } catch (_) {
          if (!kIsWeb || widget.autoplayLoopMuted) rethrow;
          _muted = true;
          await controller.setVolume(0);
          await controller.play();
        }
      }
      if (!mounted || token != _loadToken) {
        await controller.dispose();
        if (source.isLocalFile) unawaited(deleteLocalMediaFile(source.url));
        return;
      }
      if (mounted) setState(() {});
    } catch (error) {
      if (!mounted || token != _loadToken) return;
      setState(() => _error = error.toString());
    }
  }

  void _onTick() {
    if (!mounted) return;
    final value = _controller?.value;
    if (value == null) return;
    if (value.hasError) {
      setState(
        () => _error = value.errorDescription ?? 'Falha ao tocar video.',
      );
      return;
    }
    setState(() {});
    updateKeepAlive();
  }

  Future<void> _togglePlayback() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return;
    if (controller.value.isPlaying) {
      await controller.pause();
      updateKeepAlive();
      return;
    }
    await controller.play();
    updateKeepAlive();
  }

  Future<void> _openExpandedVideo() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || !mounted)
      return;
    await showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Fechar vídeo',
      barrierColor: Colors.black,
      pageBuilder: (dialogContext, animation, secondaryAnimation) {
        return _ExpandedVideoViewer(
          controller: controller,
          initiallyMuted: _muted,
          onMutedChanged: (value) {
            if (mounted) setState(() => _muted = value);
          },
        );
      },
    );
  }

  Future<void> _toggleMute() async {
    final controller = _controller;
    if (controller == null) return;
    final next = !_muted;
    setState(() => _muted = next);
    await controller.setVolume(next ? 0 : 1);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final controller = _controller;
    return ClipRRect(
      borderRadius: widget.borderRadius,
      child: SizedBox(
        width: widget.width,
        height: widget.height,
        child: DecoratedBox(
          decoration: const BoxDecoration(color: Color(0xFF111B21)),
          child: FutureBuilder<void>(
            future: _initializeFuture,
            builder: (context, snapshot) {
              if (_error != null) {
                return _MediaErrorState(
                  icon: Icons.play_circle_outline_rounded,
                  title: 'Video indisponivel',
                  subtitle: widget.title ?? _error!,
                  onOpen: () => _openExternal(widget.url),
                  onRetry: _load,
                );
              }
              if (snapshot.connectionState != ConnectionState.done ||
                  controller == null ||
                  !controller.value.isInitialized) {
                return const Center(
                  child: CircularProgressIndicator(color: Colors.white),
                );
              }
              return GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {
                  if (controller.value.isPlaying) {
                    unawaited(_togglePlayback());
                  } else {
                    unawaited(_togglePlayback());
                  }
                  setState(() => _showControls = true);
                },
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Center(
                      child: AspectRatio(
                        aspectRatio: controller.value.aspectRatio == 0
                            ? 16 / 9
                            : controller.value.aspectRatio,
                        child: VideoPlayer(controller),
                      ),
                    ),
                    if (!widget.autoplayLoopMuted &&
                        (_showControls || !controller.value.isPlaying))
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.black.withValues(alpha: 0.2),
                              Colors.transparent,
                              Colors.black.withValues(alpha: 0.5),
                            ],
                          ),
                        ),
                      ),
                    if (!widget.autoplayLoopMuted &&
                        (_showControls || !controller.value.isPlaying))
                      Center(
                        child: Material(
                          color: Colors.white.withValues(alpha: 0.92),
                          shape: const CircleBorder(),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: () => unawaited(_togglePlayback()),
                            child: SizedBox(
                              width: 56,
                              height: 56,
                              child: Icon(
                                controller.value.isPlaying
                                    ? Icons.pause_rounded
                                    : Icons.play_arrow_rounded,
                                size: 34,
                                color: const Color(0xFF111B21),
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (!widget.autoplayLoopMuted)
                      Positioned(
                        left: 10,
                        right: 10,
                        bottom: 8,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SliderTheme(
                              data: SliderTheme.of(context).copyWith(
                                trackHeight: 4,
                                activeTrackColor: const Color(0xFF00A884),
                                inactiveTrackColor: const Color(0x80FFFFFF),
                                thumbColor: const Color(0xFF00A884),
                                thumbShape: const RoundSliderThumbShape(
                                  enabledThumbRadius: 7,
                                ),
                                overlayShape: const RoundSliderOverlayShape(
                                  overlayRadius: 15,
                                ),
                              ),
                              child: Slider(
                                value: controller.value.position.inMilliseconds
                                    .clamp(
                                      0,
                                      math.max(
                                        1,
                                        controller
                                            .value
                                            .duration
                                            .inMilliseconds,
                                      ),
                                    )
                                    .toDouble(),
                                max: math
                                    .max(
                                      1,
                                      controller.value.duration.inMilliseconds,
                                    )
                                    .toDouble(),
                                onChanged: (value) => unawaited(
                                  controller.seekTo(
                                    Duration(milliseconds: value.round()),
                                  ),
                                ),
                              ),
                            ),
                            if (_showControls)
                              Row(
                                children: [
                                  Text(
                                    '${_formatDuration(controller.value.position)} / ${_formatDuration(controller.value.duration)}',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const Spacer(),
                                  IconButton(
                                    onPressed: () => unawaited(_toggleMute()),
                                    icon: Icon(
                                      _muted
                                          ? Icons.volume_off_rounded
                                          : Icons.volume_up_rounded,
                                    ),
                                    color: Colors.white,
                                    iconSize: 20,
                                    visualDensity: VisualDensity.compact,
                                    tooltip: _muted ? 'Ativar som' : 'Mutar',
                                  ),
                                  IconButton(
                                    onPressed: () =>
                                        unawaited(_openExpandedVideo()),
                                    icon: const Icon(Icons.fullscreen_rounded),
                                    color: Colors.white,
                                    iconSize: 22,
                                    visualDensity: VisualDensity.compact,
                                    tooltip: 'Expandir vídeo',
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _ExpandedVideoViewer extends StatefulWidget {
  const _ExpandedVideoViewer({
    required this.controller,
    required this.initiallyMuted,
    required this.onMutedChanged,
  });

  final VideoPlayerController controller;
  final bool initiallyMuted;
  final ValueChanged<bool> onMutedChanged;

  @override
  State<_ExpandedVideoViewer> createState() => _ExpandedVideoViewerState();
}

class _ExpandedVideoViewerState extends State<_ExpandedVideoViewer> {
  late bool _muted;

  @override
  void initState() {
    super.initState();
    _muted = widget.initiallyMuted;
    widget.controller.addListener(_refresh);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _togglePlayback() async {
    if (widget.controller.value.isPlaying) {
      await widget.controller.pause();
    } else {
      await widget.controller.play();
    }
  }

  Future<void> _toggleMute() async {
    final next = !_muted;
    setState(() => _muted = next);
    widget.onMutedChanged(next);
    await widget.controller.setVolume(next ? 0 : 1);
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final durationMs = math.max(1, controller.value.duration.inMilliseconds);
    final positionMs = controller.value.position.inMilliseconds
        .clamp(0, durationMs)
        .toDouble();
    return Material(
      color: Colors.black,
      child: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: Column(
                children: [
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final ratio = controller.value.aspectRatio <= 0
                            ? 16 / 9
                            : controller.value.aspectRatio;
                        return InteractiveViewer(
                          minScale: 1,
                          maxScale: 5,
                          clipBehavior: Clip.none,
                          child: SizedBox(
                            width: constraints.maxWidth,
                            height: constraints.maxWidth / ratio,
                            child: VideoPlayer(controller),
                          ),
                        );
                      },
                    ),
                  ),
                  Container(
                    color: Colors.black.withValues(alpha: .82),
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
                    child: Column(
                      children: [
                        SliderTheme(
                          data: SliderTheme.of(context).copyWith(
                            trackHeight: 5,
                            activeTrackColor: const Color(0xFF00A884),
                            inactiveTrackColor: Colors.white30,
                            thumbColor: const Color(0xFF00A884),
                            thumbShape: const RoundSliderThumbShape(
                              enabledThumbRadius: 8,
                            ),
                          ),
                          child: Slider(
                            value: positionMs,
                            max: durationMs.toDouble(),
                            onChanged: (value) => unawaited(
                              controller.seekTo(
                                Duration(milliseconds: value.round()),
                              ),
                            ),
                          ),
                        ),
                        Row(
                          children: [
                            IconButton(
                              onPressed: () => unawaited(_togglePlayback()),
                              icon: Icon(
                                controller.value.isPlaying
                                    ? Icons.pause_rounded
                                    : Icons.play_arrow_rounded,
                              ),
                              color: Colors.white,
                            ),
                            Text(
                              '${_formatDuration(controller.value.position)} / ${_formatDuration(controller.value.duration)}',
                              style: const TextStyle(color: Colors.white),
                            ),
                            const Spacer(),
                            IconButton(
                              tooltip: _muted ? 'Ativar som' : 'Mutar',
                              onPressed: () => unawaited(_toggleMute()),
                              icon: Icon(
                                _muted
                                    ? Icons.volume_off_rounded
                                    : Icons.volume_up_rounded,
                              ),
                              color: Colors.white,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: Material(
                color: Colors.black54,
                shape: const CircleBorder(),
                child: IconButton(
                  tooltip: 'Fechar',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded, color: Colors.white),
                ),
              ),
            ),
            const Positioned(
              top: 18,
              left: 18,
              child: Text(
                'Use dois dedos para ampliar',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class InlineAudioPlayer extends ConsumerStatefulWidget {
  const InlineAudioPlayer({
    super.key,
    required this.url,
    this.title,
    this.compact = false,
    this.mimeType,
    this.durationSeconds,
    this.autoplay = false,
  });

  final String url;
  final String? title;
  final bool compact;
  final String? mimeType;
  final int? durationSeconds;
  final bool autoplay;

  @override
  ConsumerState<InlineAudioPlayer> createState() => _InlineAudioPlayerState();
}

class _InlineAudioPlayerState extends ConsumerState<InlineAudioPlayer>
    with AutomaticKeepAliveClientMixin {
  static const List<double> _playbackSpeeds = [1, 1.5, 2, 3];

  // Instantiate eagerly. `AutomaticKeepAliveClientMixin` may query
  // `wantKeepAlive` during the first mount, before `initState` finishes;
  // keeping this non-late prevents a transient LateInitializationError that
  // used to replace the MP3 player with an empty/grey bubble.
  final AudioPlayer _player = AudioPlayer();
  StreamSubscription<PlayerState>? _stateSub;
  String? _error;
  bool _loading = true;
  bool _resettingAfterCompletion = false;
  double _playbackSpeed = 1;
  String? _blobUrl;
  String? _localFilePath;
  int _loadToken = 0;

  @override
  bool get wantKeepAlive => _player.playing;

  @override
  void initState() {
    super.initState();
    _stateSub = _player.playerStateStream.listen((state) {
      if (!mounted) return;
      if (state.processingState == ProcessingState.completed) {
        unawaited(_resetAfterCompletion());
        return;
      }
      setState(() {});
      updateKeepAlive();
    });
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant InlineAudioPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url || oldWidget.mimeType != widget.mimeType) {
      unawaited(_load());
    } else if (!oldWidget.autoplay && widget.autoplay) {
      unawaited(_player.play());
    }
  }

  @override
  void dispose() {
    _stateSub?.cancel();
    unawaited(_player.dispose());
    revokeMediaBlobUrl(_blobUrl);
    unawaited(deleteLocalMediaFile(_localFilePath));
    super.dispose();
  }

  Future<void> _load() async {
    final token = ++_loadToken;
    setState(() {
      _loading = true;
      _error = null;
    });
    final previousBlob = _blobUrl;
    final previousLocalFile = _localFilePath;
    _blobUrl = null;
    _localFilePath = null;
    revokeMediaBlobUrl(previousBlob);
    unawaited(deleteLocalMediaFile(previousLocalFile));

    try {
      var source = await _resolvePlayableSource(
        ref,
        widget.url,
        preferredMime: widget.mimeType ?? 'audio/ogg',
      );
      if (!mounted || token != _loadToken) {
        if (source.isBlob) revokeMediaBlobUrl(source.url);
        if (source.isLocalFile) unawaited(deleteLocalMediaFile(source.url));
        return;
      }
      _blobUrl = source.isBlob ? source.url : null;
      _localFilePath = source.isLocalFile ? source.url : null;
      try {
        await _player.setAudioSource(
          AudioSource.uri(
            source.isLocalFile ? Uri.file(source.url) : Uri.parse(source.url),
            headers: source.headers,
          ),
        );
      } catch (_) {
        if (source.isBlob) revokeMediaBlobUrl(source.url);
        if (source.isLocalFile) unawaited(deleteLocalMediaFile(source.url));
        source = await _resolvePlayableSource(
          ref,
          widget.url,
          preferredMime: widget.mimeType ?? 'audio/ogg',
          forceRefresh: true,
        );
        if (!mounted || token != _loadToken) {
          if (source.isBlob) revokeMediaBlobUrl(source.url);
          if (source.isLocalFile) unawaited(deleteLocalMediaFile(source.url));
          return;
        }
        _blobUrl = source.isBlob ? source.url : null;
        _localFilePath = source.isLocalFile ? source.url : null;
        await _player.setAudioSource(
          AudioSource.uri(
            source.isLocalFile ? Uri.file(source.url) : Uri.parse(source.url),
            headers: source.headers,
          ),
        );
      }
      await _player.setSpeed(_playbackSpeed);
      if (widget.autoplay && mounted && token == _loadToken) {
        try {
          await _player.play();
        } catch (_) {
          if (!kIsWeb) rethrow;
          // Browsers may block audible autoplay after an authenticated fetch.
          // Keep the player ready so one tap starts it instead of showing an
          // incorrect "mídia indisponível" error.
        }
      }
    } catch (error) {
      if (mounted && token == _loadToken) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted && token == _loadToken) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _togglePlayback() async {
    if (_loading || _error != null || _resettingAfterCompletion) return;
    if (_player.playing) {
      await _player.pause();
    } else {
      final duration = _player.duration;
      final isAtEnd =
          _player.processingState == ProcessingState.completed ||
          (duration != null &&
              duration > Duration.zero &&
              _player.position >= duration - const Duration(milliseconds: 120));
      if (isAtEnd) await _player.seek(Duration.zero);
      await _player.play();
    }
    if (mounted) setState(() {});
    updateKeepAlive();
  }

  Future<void> _resetAfterCompletion() async {
    if (_resettingAfterCompletion) return;
    _resettingAfterCompletion = true;
    try {
      await _player.pause();
      await _player.seek(Duration.zero);
    } catch (_) {
      // O próximo toque ainda tenta voltar ao início antes de reproduzir.
    } finally {
      _resettingAfterCompletion = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _cyclePlaybackSpeed() async {
    final currentIndex = _playbackSpeeds.indexWhere(
      (speed) => (speed - _playbackSpeed).abs() < .01,
    );
    final nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + 1) % _playbackSpeeds.length;
    final next = _playbackSpeeds[nextIndex];
    await _player.setSpeed(next);
    if (mounted) setState(() => _playbackSpeed = next);
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_error != null) {
      return _AudioFallbackPlayer(
        title: widget.title,
        errorMessage: _error,
        compact: widget.compact,
        onRetry: () => unawaited(_load()),
      );
    }

    final knownDuration = widget.durationSeconds != null
        ? Duration(seconds: widget.durationSeconds!)
        : null;

    return Container(
      constraints: BoxConstraints(maxWidth: widget.compact ? 280 : 340),
      padding: const EdgeInsets.fromLTRB(8, 8, 10, 8),
      decoration: BoxDecoration(
        color: const Color(0x0F000000),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Material(
            color: const Color(0xFF00A884),
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: _loading ? null : () => unawaited(_togglePlayback()),
              child: SizedBox(
                width: 42,
                height: 42,
                child: Center(
                  child: _loading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          _player.playing &&
                                  _player.processingState !=
                                      ProcessingState.completed &&
                                  !_resettingAfterCompletion
                              ? Icons.pause_rounded
                              : Icons.play_arrow_rounded,
                          color: Colors.white,
                          size: 24,
                        ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Tooltip(
            message: 'Velocidade do áudio',
            child: Material(
              color: const Color(0x14000000),
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: _loading ? null : () => unawaited(_cyclePlaybackSpeed()),
                child: SizedBox(
                  width: 40,
                  height: 30,
                  child: Center(
                    child: Text(
                      '${_playbackSpeed % 1 == 0 ? _playbackSpeed.toInt() : _playbackSpeed}x',
                      style: const TextStyle(
                        color: Color(0xFF111B21),
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: StreamBuilder<Duration>(
              stream: _player.positionStream,
              builder: (context, positionSnapshot) {
                final position = positionSnapshot.data ?? Duration.zero;
                final duration =
                    _player.duration ?? knownDuration ?? Duration.zero;
                final maxMs = duration.inMilliseconds <= 0
                    ? 1.0
                    : duration.inMilliseconds.toDouble();
                final valueMs = position.inMilliseconds
                    .clamp(0, maxMs.toInt())
                    .toDouble();
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        trackHeight: 4.5,
                        thumbShape: const RoundSliderThumbShape(
                          enabledThumbRadius: 7,
                        ),
                        overlayShape: const RoundSliderOverlayShape(
                          overlayRadius: 15,
                        ),
                        activeTrackColor: const Color(0xFF00A884),
                        inactiveTrackColor: const Color(0xFFD1D7DB),
                        thumbColor: const Color(0xFF00A884),
                      ),
                      child: Slider(
                        value: valueMs,
                        max: maxMs,
                        onChanged: duration.inMilliseconds <= 0
                            ? null
                            : (value) => unawaited(
                                _player.seek(
                                  Duration(milliseconds: value.round()),
                                ),
                              ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: Row(
                        children: [
                          Text(
                            _formatDuration(position),
                            style: const TextStyle(
                              color: Color(0xFF667781),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            duration.inMilliseconds > 0
                                ? _formatDuration(duration)
                                : (widget.title?.trim().isNotEmpty == true
                                      ? widget.title!
                                      : 'Áudio'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF667781),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _AudioFallbackPlayer extends StatelessWidget {
  const _AudioFallbackPlayer({
    required this.title,
    this.errorMessage,
    required this.compact,
    this.onRetry,
  });

  final String? title;
  final String? errorMessage;
  final bool compact;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final label = (title ?? '').trim().isEmpty ? 'Áudio' : title!.trim();
    return Container(
      constraints: BoxConstraints(maxWidth: compact ? 280 : 340),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0x14000000),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Material(
            color: const Color(0xFF00A884),
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onRetry,
              child: const SizedBox(
                width: 42,
                height: 42,
                child: Icon(Icons.play_arrow_rounded, color: Colors.white),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF111B21),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  _friendlyAudioError(errorMessage),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF667781),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          if (onRetry != null)
            IconButton(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              tooltip: 'Tentar de novo',
              color: const Color(0xFF54656F),
            ),
        ],
      ),
    );
  }
}

String _friendlyAudioError(String? value) {
  final normalized = (value ?? '').toLowerCase();
  if (normalized.contains('expired') ||
      normalized.contains('whatsapp_media_expired') ||
      normalized.contains('status code 403') ||
      normalized.contains('invalid media hmac')) {
    return 'Mídia expirada no WhatsApp. Peça para reenviar.';
  }
  return 'Não foi possível carregar. Toque para tentar novamente.';
}

class _MediaErrorState extends StatelessWidget {
  const _MediaErrorState({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onOpen,
    this.onRetry,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onOpen;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 320),
      padding: const EdgeInsets.all(12),
      color: const Color(0xFF202C33),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
                ),
              ],
            ),
          ),
          if (onRetry != null)
            IconButton(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              color: Colors.white,
              tooltip: 'Tentar de novo',
            ),
          IconButton(
            onPressed: onOpen,
            icon: const Icon(Icons.open_in_new_rounded),
            color: Colors.white,
            tooltip: 'Abrir mídia',
          ),
        ],
      ),
    );
  }
}

String _formatDuration(Duration duration) {
  final totalSeconds = duration.inSeconds.clamp(0, 24 * 3600);
  final minutes = totalSeconds ~/ 60;
  final seconds = totalSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

Future<void> _openExternal(String value) async {
  final uri = Uri.tryParse(resolvePlaybackUrl(value));
  if (uri == null) return;
  await launchUrl(uri, mode: LaunchMode.externalApplication);
}
