import 'dart:async';
import 'dart:collection';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/session_store.dart';

class AuthenticatedMediaImage extends ConsumerStatefulWidget {
  const AuthenticatedMediaImage({
    super.key,
    required this.url,
    required this.fit,
    this.width,
    this.height,
    this.placeholder,
    this.errorWidget,
  });

  final String url;
  final BoxFit fit;
  final double? width;
  final double? height;
  final Widget? placeholder;
  final Widget? errorWidget;

  @override
  ConsumerState<AuthenticatedMediaImage> createState() =>
      _AuthenticatedMediaImageState();
}

class _AuthenticatedMediaImageState
    extends ConsumerState<AuthenticatedMediaImage> {
  static const _maxCacheEntries = 64;
  static const _maxCacheBytes = 48 * 1024 * 1024;
  static final LinkedHashMap<String, Uint8List> _memoryCache =
      LinkedHashMap<String, Uint8List>();
  static final Map<String, Future<Uint8List>> _inFlight = {};
  static int _cacheBytes = 0;
  static int _cacheRevision = -1;

  Future<Uint8List>? _future;

  @override
  void initState() {
    super.initState();
    BotAdminSessionStore.sessionRevision.addListener(_onSessionChanged);
    _future = _load(widget.url);
  }

  @override
  void dispose() {
    BotAdminSessionStore.sessionRevision.removeListener(_onSessionChanged);
    super.dispose();
  }

  void _onSessionChanged() {
    _clearForCurrentSession();
    if (!mounted) return;
    setState(() => _future = _load(widget.url));
  }

  @override
  void didUpdateWidget(covariant AuthenticatedMediaImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) {
      _future = _load(widget.url);
    }
  }

  Future<Uint8List> _load(String url) {
    _clearForCurrentSession();
    final key = '${BotAdminSessionStore.sessionRevision.value}|$url';
    final cached = _memoryCache.remove(key);
    if (cached != null) {
      _memoryCache[key] = cached;
      return Future<Uint8List>.value(cached);
    }
    final running = _inFlight[key];
    if (running != null) return running;

    final request = _downloadWithRecovery(url);
    _inFlight[key] = request;
    unawaited(
      request
          .then((bytes) {
            _inFlight.remove(key);
            if (key.startsWith(
              '${BotAdminSessionStore.sessionRevision.value}|',
            )) {
              _remember(key, bytes);
            }
          })
          .catchError((Object _) {
            _inFlight.remove(key);
          }),
    );
    return request;
  }

  static void _clearForCurrentSession() {
    final revision = BotAdminSessionStore.sessionRevision.value;
    if (_cacheRevision == revision) return;
    _cacheRevision = revision;
    _memoryCache.clear();
    _inFlight.clear();
    _cacheBytes = 0;
  }

  Future<Uint8List> _downloadWithRecovery(String url) async {
    try {
      return (await ref.read(apiClientProvider).downloadMediaBytes(url)).bytes;
    } catch (_) {
      return (await ref
              .read(apiClientProvider)
              .downloadMediaBytes(url, forceRefresh: true))
          .bytes;
    }
  }

  static void _remember(String url, Uint8List bytes) {
    final previous = _memoryCache.remove(url);
    if (previous != null) _cacheBytes -= previous.lengthInBytes;
    _memoryCache[url] = bytes;
    _cacheBytes += bytes.lengthInBytes;
    while (_memoryCache.length > _maxCacheEntries ||
        _cacheBytes > _maxCacheBytes) {
      final oldestKey = _memoryCache.keys.first;
      final removed = _memoryCache.remove(oldestKey);
      if (removed != null) _cacheBytes -= removed.lengthInBytes;
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: _future,
      builder: (context, snapshot) {
        final bytes = snapshot.data;
        if (bytes != null && bytes.isNotEmpty) {
          return Image.memory(
            bytes,
            width: widget.width,
            height: widget.height,
            fit: widget.fit,
            gaplessPlayback: true,
            filterQuality: FilterQuality.medium,
            errorBuilder: (_, _, _) =>
                widget.errorWidget ?? const SizedBox.shrink(),
          );
        }
        if (snapshot.hasError) {
          return widget.errorWidget ?? const SizedBox.shrink();
        }
        return widget.placeholder ??
            SizedBox(width: widget.width, height: widget.height);
      },
    );
  }
}
